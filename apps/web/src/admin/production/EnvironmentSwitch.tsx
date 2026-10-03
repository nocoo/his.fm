import { toast } from '@nocoo/basalt';
import { SegmentControl } from '@nocoo/basalt/components/segment-control';
import { useState } from 'react';
import { type AdminEnvironment, getEnvironment, selectEnvironment } from '../environment';
import { errorMessage } from '../model';
import { connectProduction } from '../service';
import { Confirm } from './controls';
import { confirmEnvironmentNavigation, hasUnsavedChanges } from './useUnsavedChanges';

export function EnvironmentSwitch() {
  const environment = getEnvironment();
  const [next, setNext] = useState<AdminEnvironment | null>(null);
  const [pending, setPending] = useState(false);
  async function switchEnvironment(value: AdminEnvironment) {
    setPending(true);
    try {
      if (value === 'production') await connectProduction();
      selectEnvironment(value);
      confirmEnvironmentNavigation();
      window.location.assign('/admin');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <SegmentControl
        className="studio-environment"
        legend={<span className="sr-only">工作室数据环境</span>}
        value={environment}
        disabled={pending}
        options={[
          { value: 'local', label: 'Local' },
          { value: 'production', label: 'Prod' },
        ]}
        onValueChange={(value) => {
          if (value === environment) return;
          const target = value as AdminEnvironment;
          if (hasUnsavedChanges()) setNext(target);
          else void switchEnvironment(target).catch((cause) => toast.error(errorMessage(cause)));
        }}
      />
      {next && (
        <Confirm
          title={`切换到${next === 'local' ? '本地' : '生产'}环境`}
          description={`将重新加载${next === 'local' ? '本地' : '生产'}工作室数据，当前未保存的内容会丢弃。${next === 'production' ? '此后的操作会修改生产数据。首次连接时，请在打开的浏览器中完成生产登录。' : ''}`}
          onClose={() => setNext(null)}
          onConfirm={() => switchEnvironment(next)}
        />
      )}
    </>
  );
}
