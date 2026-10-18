import { Button, Field, Input, LayerCard, toast } from '@nocoo/basalt';
import { IconPicker } from '@nocoo/basalt/components/icon-picker';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagColorPicker } from '@nocoo/basalt/components/tag-color-picker';
import { ArrowLeft, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type Category, categoryColors, categoryIcons, type PublicCategory } from '../../shared/category';
import { Confirm, Failure } from '../production/controls';
import { ReadingText } from '../production/ReadingText';
import { SeoOverrideFields } from '../seo/SeoOverrideFields';
import { CategoryBadge, categoryIconComponents } from './CategoryBadge';
import { categoryService } from './service';
import { useCategories } from './useCategories';
import { useCategory } from './useCategory';
import './categories.css';

export default function CategoryPage() {
  const { id } = useParams();
  return id ? <CategoryEditor key={id} id={id} /> : <CategoryList />;
}
function CategoryList() {
  const vm = useCategories();
  const [deleting, setDeleting] = useState<PublicCategory | null>(null);
  return (
    <div className="admin-page">
      <PageHeader
        title="栏目管理"
        actions={
          <Button asChild>
            <Link to="/admin/categories/new">
              <Plus size={16} />
              新建栏目
            </Link>
          </Button>
        }
      />
      {vm.error && <Failure error={vm.error} retry={() => void vm.load()} />}
      {vm.loading ? (
        <LayerCard.Loading label="正在读取栏目" />
      ) : vm.categories.length ? (
        <div className="category-list">
          {vm.categories.map((category) => (
            <LayerCard key={category.id} className="studio-row">
              <CategoryBadge category={category} />
              <div className="studio-actions">
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/admin/categories/${category.id}`}>
                    <Pencil size={15} />
                    编辑 {category.name}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`删除 ${category.name}`}
                  onClick={() => setDeleting(category)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </LayerCard>
          ))}
        </div>
      ) : (
        <LayerCard.Empty title="还没有栏目" description="创建栏目后，可在节目选题里选择。" />
      )}
      {deleting && (
        <Confirm
          title="删除栏目"
          description={`确认删除「${deleting.name}」？已经被节目或制作任务引用的栏目不能删除。`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const { category } = await categoryService.get(deleting.id);
            await categoryService.remove(category.id, category.version);
            await vm.load();
            toast.success('栏目已删除');
          }}
        />
      )}
    </div>
  );
}
function CategoryEditor({ id }: { id: string }) {
  const vm = useCategory(id);
  const navigate = useNavigate();
  const [replace, setReplace] = useState<Category | null>(null);
  const save = async (version?: number) => {
    const result = await vm.save(version);
    if (result) {
      toast.success('栏目已保存');
      if (id === 'new' || result.id !== id) navigate(`/admin/categories/${result.id}`, { replace: true });
    }
  };
  const saveButton = (
    <Button
      loading={vm.pending}
      disabled={!vm.dirty || !vm.value.name.trim() || Boolean(vm.conflict)}
      onClick={() => void save()}
    >
      <Save size={16} />
      保存栏目
    </Button>
  );
  return (
    <div className="admin-page category-editor">
      <PageHeader
        title={
          <span className="category-page-title">
            <Button asChild variant="ghost" size="icon">
              <Link to="/admin/categories" aria-label="返回栏目管理">
                <ArrowLeft size={18} />
              </Link>
            </Button>
            {id === 'new' ? '新建栏目' : (vm.saved?.name ?? '编辑栏目')}
          </span>
        }
        actions={saveButton}
      />
      {vm.error && (
        <Failure error={vm.error} retry={!vm.saved && id !== 'new' ? () => void vm.load() : undefined} />
      )}
      {vm.loading ? (
        <LayerCard.Loading label="正在读取栏目" />
      ) : (
        <>
          <LayerCard className="studio-stack">
            <div className="category-fields">
              <Field label="栏目 ID" htmlFor="category-id">
                <Input
                  id="category-id"
                  value={vm.nextId}
                  maxLength={120}
                  disabled={vm.pending || id === 'new'}
                  onChange={(event) => vm.setNextId(event.target.value)}
                />
                <p className="admin-muted">小写英文与连字符；保存时会同步更新已关联节目与制作任务。</p>
              </Field>
              <Field label="栏目名称" htmlFor="category-name" required>
                <Input
                  id="category-name"
                  value={vm.value.name}
                  maxLength={80}
                  disabled={vm.pending}
                  onChange={(event) => vm.setValue({ ...vm.value, name: event.target.value })}
                />
              </Field>
              <Field label="Lucide 图标">
                <IconPicker
                  label="栏目图标"
                  value={vm.value.icon}
                  onValueChange={(icon) => vm.setValue({ ...vm.value, icon: icon as typeof vm.value.icon })}
                  disabled={vm.pending}
                  searchPlaceholder="搜索图标"
                  emptyLabel="没有匹配图标"
                  options={categoryIcons.map((value) => {
                    const Icon = categoryIconComponents[value];
                    return { value, label: value, icon: <Icon size={16} strokeWidth={1.5} /> };
                  })}
                />
              </Field>
            </div>
            <Field label="栏目颜色">
              <TagColorPicker
                label="栏目颜色"
                value={vm.value.color}
                colors={categoryColors}
                labels={{ slate: '灰', blue: '蓝', violet: '紫', teal: '青', amber: '琥珀', rose: '玫瑰' }}
                onValueChange={(color) => vm.setValue({ ...vm.value, color: color as typeof vm.value.color })}
                disabled={vm.pending}
              />
            </Field>
            <CategoryBadge category={{ id, ...vm.value, name: vm.value.name || '栏目预览' }} />
          </LayerCard>
          <LayerCard className="studio-stack">
            <strong>栏目 SEO</strong>
            <p className="admin-muted">作用于栏目列表筛选页与栏目 RSS。</p>
            <SeoOverrideFields
              idPrefix={`category-${id}`}
              disabled={vm.pending}
              value={vm.value.seo ?? {}}
              onChange={(seo) => vm.setValue({ ...vm.value, seo })}
            />
          </LayerCard>
          {vm.conflict && (
            <LayerCard className="studio-stack">
              <strong>栏目已有新版本 · v{vm.conflict.version}</strong>
              <p>你的草稿已保留，请先对照再保存。</p>
              <details>
                <summary>查看已保存版本</summary>
                <CategoryBadge category={vm.conflict} />
                <ReadingText text={vm.conflict.prompt} />
              </details>
              <div className="studio-actions">
                <Button variant="outline" onClick={() => setReplace(vm.conflict)}>
                  采用最新版本
                </Button>
                <Button disabled={vm.pending} onClick={() => void save(vm.conflict?.version)}>
                  用我的草稿更新
                </Button>
              </div>
            </LayerCard>
          )}
          <Button asChild variant="outline" disabled={id === 'new'}>
            <Link to={`/admin/channel?scope=category:${id}`}>前往提示词管理栏目槽位</Link>
          </Button>
          <div className="studio-stage-footer">
            <span className="admin-muted" role="status">
              {vm.dirty ? '有未保存改动' : vm.saved ? `已保存 · v${vm.saved.version}` : '尚未保存'}
            </span>
            <p className="admin-muted">
              逐字稿依次读取全局提示词、栏目提示词、本期创作意图和素材。留空不追加风格；保存不会重写现有节目或撤销审批。
            </p>
          </div>
        </>
      )}
      {replace && (
        <Confirm
          title="采用最新栏目"
          description="当前未保存草稿将被替换。"
          onClose={() => setReplace(null)}
          onConfirm={async () => vm.replace(replace)}
        />
      )}
    </div>
  );
}
