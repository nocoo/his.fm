import {
  type BrowserFrame,
  browserFrameSchema,
  type DraftProposal,
  maxFrameBytes,
  type PageContext,
  type ServerFrame,
  serverFrameSchema,
} from '@his-fm/contracts';
import { canApplyProposal, initialAgentState, reduceAgent } from './model';

export class AgentClient {
  state = initialAgentState;
  context: PageContext | null = null;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private events = new Set<(frame: ServerFrame) => void>();
  private outbox = new Map<string, BrowserFrame>();
  private receipts = new Map<string, 'applied' | 'stale' | 'rejected'>();
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastMessage = 0;
  private attempts = 0;
  private stopped = true;
  private ready = false;
  private acknowledgedSeq = -1;
  private applyDraft: ((proposal: DraftProposal) => boolean) | null = null;
  private readonly tabId = crypto.randomUUID();

  constructor(
    private readonly url: string,
    private readonly createSocket = (url: string) => new WebSocket(url),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  onFrame = (listener: (frame: ServerFrame) => void) => {
    this.events.add(listener);
    return () => {
      this.events.delete(listener);
    };
  };
  private update(state: typeof this.state) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  start = () => {
    this.stopped = false;
    this.connect();
  };
  stop = () => {
    this.stopped = true;
    this.ready = false;
    this.acknowledgedSeq = -1;
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    this.socket?.close();
    this.socket = null;
  };
  private connect() {
    this.update({ ...this.state, connection: 'connecting' });
    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.lastMessage = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastMessage >= 30000) socket.close();
      else this.write({ type: 'ping' });
    }, 10000);
    socket.onopen = () => {
      if (this.socket === socket) this.write({ type: 'ping' });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.stopped) return;
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > maxFrameBytes) {
        socket.close(1009);
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        socket.close(1002);
        return;
      }
      const parsed = serverFrameSchema.safeParse(raw);
      if (!parsed.success) {
        socket.close(1002);
        return;
      }
      this.lastMessage = Date.now();
      const frame = parsed.data;
      if (frame.type === 'snapshot') {
        this.ready = true;
        this.attempts = 0;
        for (const command of frame.commands) {
          this.outbox.delete(`command:${command.id}`);
          if (['complete', 'failed', 'cancelled'].includes(command.status))
            this.outbox.delete(`cancel:${command.id}`);
        }
        if (this.context) this.write({ type: 'context', context: this.context });
        this.flush();
      }
      if (
        frame.type === 'context.ack' &&
        frame.tabId === this.tabId &&
        frame.seq <= (this.context?.seq ?? -1)
      ) {
        this.acknowledgedSeq = Math.max(this.acknowledgedSeq, frame.seq);
        this.flush();
      }
      if (frame.type === 'command.ack') {
        this.outbox.delete(`command:${frame.id}`);
        this.flush();
      }
      if (frame.type === 'proposal.ack') this.outbox.delete(`proposal:${frame.id}`);
      if (frame.type === 'command.state' && ['complete', 'failed', 'cancelled'].includes(frame.status))
        this.outbox.delete(`cancel:${frame.commandId}`);
      let state = reduceAgent(this.state, frame);
      state = {
        ...state,
        proposals: state.proposals.filter(
          (proposal) =>
            proposal.context.tabId === this.tabId &&
            !['applied', 'rejected'].includes(this.receipts.get(proposal.id) ?? ''),
        ),
      };
      if (frame.type === 'snapshot') {
        for (const pending of this.outbox.values()) {
          if (
            pending.type === 'command' &&
            !state.messages.some((message) => message.commandId === pending.id)
          ) {
            state = reduceAgent(state, {
              type: 'message',
              message: {
                id: `user:${pending.id}`,
                role: 'user',
                text: pending.text,
                commandId: pending.id,
                createdAt: new Date().toISOString(),
              },
            });
            state = {
              ...state,
              commands: [
                ...state.commands,
                { id: pending.id, status: 'queued', detail: '等待主控接收' },
              ].slice(-100),
            };
          }
        }
      }
      this.update(state);
      if (frame.type === 'proposal' || frame.type === 'snapshot') {
        for (const proposal of this.state.proposals) {
          if (!this.receipts.has(proposal.id) && this.outbox.size < 100) this.proposal(proposal, true);
        }
      }
      for (const listener of this.events) listener(frame);
      if (frame.deliveryId !== undefined) this.write({ type: 'delivery.ack', deliveryId: frame.deliveryId });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket || this.stopped) return;
      this.ready = false;
      this.acknowledgedSeq = -1;
      this.socket = null;
      clearInterval(this.heartbeat);
      const blocked = [1002, 1008, 4001, 4003, 4401, 4403].includes(event.code);
      this.update({
        ...this.state,
        connection: blocked ? 'blocked' : 'offline',
        online: false,
        error: blocked ? '连接授权或协议已失效，请重新登录工作室。未保存内容仍保留。' : this.state.error,
      });
      if (!blocked)
        this.reconnect = setTimeout(
          () => this.connect(),
          Math.min(15000, 1000 * 2 ** this.attempts++) * (0.8 + Math.random() * 0.4),
        );
    };
  }
  private write(frame: BrowserFrame) {
    if (this.socket?.readyState !== 1) return;
    if (new TextEncoder().encode(JSON.stringify(frame)).length > maxFrameBytes) return;
    if (this.socket.bufferedAmount > 1024 * 1024) {
      this.socket.close(1013);
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }
  private enqueue(key: string, frame: BrowserFrame) {
    if (
      !browserFrameSchema.safeParse(frame).success ||
      new TextEncoder().encode(JSON.stringify(frame)).length > maxFrameBytes
    )
      throw new Error('当前内容超出安全传输范围，请缩短内容后再发送。输入仍保留。');
    if (this.outbox.size >= 100) throw new Error('待发送消息已满，请等待连接恢复后重试。');
    this.outbox.set(key, frame);
    if (this.ready && this.canSend(frame)) this.write(frame);
  }
  private canSend(frame: BrowserFrame) {
    if (frame.type === 'command' && frame.context) return frame.context.seq <= this.acknowledgedSeq;
    if (frame.type === 'cancel') return !this.outbox.has(`command:${frame.commandId}`);
    return true;
  }
  private flush() {
    for (const frame of this.outbox.values()) if (this.canSend(frame)) this.write(frame);
  }
  command(text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 12000) throw new Error('请输入 1–12,000 字的消息。');
    const id = crypto.randomUUID();
    this.enqueue(`command:${id}`, {
      type: 'command',
      id,
      text: trimmed,
      context: this.context ? structuredClone(this.context) : null,
    });
    this.update(
      reduceAgent(this.state, {
        type: 'message',
        message: {
          id: `user:${id}`,
          role: 'user',
          text: trimmed,
          commandId: id,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    this.update({
      ...this.state,
      commands: [...this.state.commands, { id, status: 'queued', detail: '等待主控接收' }].slice(-100),
    });
  }
  cancel(commandId: string) {
    this.enqueue(`cancel:${commandId}`, { type: 'cancel', commandId });
  }
  setPage(page: Pick<PageContext, 'route' | 'productionId' | 'step' | 'sourceId' | 'version' | 'activity'>) {
    const previous = this.context;
    const changed =
      !previous ||
      ['route', 'productionId', 'step', 'sourceId'].some(
        (key) => previous[key as keyof PageContext] !== page[key as keyof typeof page],
      );
    if (changed) this.applyDraft = null;
    this.setContext({
      tabId: this.tabId,
      pageEpoch: (previous?.pageEpoch ?? 0) + Number(changed),
      seq: previous?.seq ?? 0,
      field: changed ? null : previous.field,
      draft: changed ? null : previous.draft,
      selection: changed ? null : previous.selection,
      ...page,
    });
  }
  field(
    update: Pick<PageContext, 'field' | 'draft' | 'selection'>,
    apply: (proposal: DraftProposal) => boolean,
  ) {
    if (
      !this.context?.productionId ||
      update.field?.productionId !== this.context.productionId ||
      (update.field.sourceId ?? null) !== this.context.sourceId
    )
      return;
    const step =
      update.field.field === 'transcript'
        ? 'script'
        : ['summary', 'description'].includes(update.field.field)
          ? 'assets'
          : 'brief';
    if (this.context.step !== step) return;
    this.applyDraft = apply;
    this.setContext({ ...this.context, ...update });
  }
  private setContext(context: PageContext) {
    if (JSON.stringify(context) === JSON.stringify(this.context)) return;
    this.context = { ...context, seq: context.seq + 1 };
    const frame = { type: 'context' as const, context: this.context };
    if (
      !browserFrameSchema.safeParse(frame).success ||
      new TextEncoder().encode(JSON.stringify(frame)).length > maxFrameBytes
    )
      return;
    if (this.ready) this.write(frame);
  }
  proposal(proposal: DraftProposal, accept: boolean) {
    if (this.outbox.size >= 100) throw new Error('待发送消息已满，请等待连接恢复后重试。');
    const previous = this.receipts.get(proposal.id);
    const status =
      (previous === 'applied' || previous === 'rejected' ? previous : undefined) ??
      (!accept
        ? 'rejected'
        : canApplyProposal(proposal, this.context) && this.applyDraft?.(proposal)
          ? 'applied'
          : 'stale');
    this.receipts.set(proposal.id, status);
    if (this.receipts.size > 200) this.receipts.delete(this.receipts.keys().next().value as string);
    this.enqueue(`proposal:${proposal.id}`, { type: 'proposal.ack', id: proposal.id, status });
    this.update({
      ...this.state,
      proposals:
        status === 'stale'
          ? this.state.proposals
          : this.state.proposals.filter((item) => item.id !== proposal.id),
      error: status === 'stale' ? '建议对应的内容已变化，未覆盖当前输入。请让主控基于当前内容重新修改。' : '',
    });
    return status;
  }
}
