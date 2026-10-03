import { Button } from '@nocoo/basalt';

export function DraftConflicts({
  fields,
  resolve,
}: {
  fields: readonly string[];
  resolve: (keep: boolean) => void;
}) {
  if (!fields.length) return null;
  return (
    <div className="studio-notice" role="alert">
      <p>这些字段在服务端也有修改，你的输入已保留：{fields.join('、')}。核对后再保存。</p>
      <div className="studio-actions">
        <Button type="button" size="sm" variant="outline" onClick={() => resolve(false)}>
          采用服务端内容
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => resolve(true)}>
          保留我的输入
        </Button>
      </div>
    </div>
  );
}
