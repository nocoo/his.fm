import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Field,
  toast,
} from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select';
import { useState } from 'react';
import { errorMessage } from '../model';

export function Choice({
  label,
  value,
  onChange,
  options,
  name,
  disabled,
  onFocus,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string; group?: string }[];
  name?: string;
  disabled?: boolean;
  onFocus?: () => void;
}) {
  return (
    <Select name={name} value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className="studio-select-trigger"
        aria-label={label}
        onFocus={onFocus}
        title={options.find((option) => option.value === value)?.label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="studio-select-content" align="end" collisionPadding={12}>
        {[...new Set(options.map((option) => option.group))].map((group) => (
          <SelectGroup key={group ?? 'options'}>
            {group && <SelectLabel>{group}</SelectLabel>}
            {options
              .filter((option) => option.group === group)
              .map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Confirm({
  title,
  description,
  feedback = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  feedback?: boolean;
  onConfirm: (feedback: string) => Promise<boolean> | Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {feedback && (
          <Field label="修改意见" htmlFor="review-feedback" required>
            <InputArea
              id="review-feedback"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              maxLength={12000}
              disabled={pending}
              placeholder="说明需要修改的内容，主控会收到这些意见。"
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button
            loading={pending}
            disabled={feedback && !text.trim()}
            onClick={async () => {
              setPending(true);
              setError('');
              try {
                if ((await onConfirm(text)) !== false) onClose();
                else setError('操作未完成，请关闭对话框查看提示后重试。');
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            {title}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function CopyButton({
  label,
  read,
  disabled = false,
}: {
  disabled?: boolean;
  label: string;
  read: () => string | { html: string; text: string } | Promise<string | { html: string; text: string }>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      disabled={disabled}
      onClick={async () => {
        setPending(true);
        try {
          const result = read();
          const content = result instanceof Promise ? await result : result;
          if (typeof content === 'string') await navigator.clipboard.writeText(content);
          else
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': new Blob([content.html], { type: 'text/html' }),
                'text/plain': new Blob([content.text], { type: 'text/plain' }),
              }),
            ]);
          toast.success('已复制');
        } catch (cause) {
          toast.error(`复制失败，请重试：${errorMessage(cause)}`);
        } finally {
          setPending(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
export function Failure({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="admin-error-banner studio-row" role="alert">
      <span>{error}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          重新加载
        </Button>
      )}
    </div>
  );
}
