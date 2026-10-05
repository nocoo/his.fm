import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select';
import { Failure } from '../production/controls';
import { CategoryBadge } from './CategoryBadge';
import { useCategories } from './useCategories';

export function CategorySelect({
  value,
  defaultValue,
  onChange,
  disabled,
  onFocus,
  id,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  onFocus?: () => void;
  id?: string;
}) {
  const vm = useCategories();
  return (
    <div className="studio-stack studio-gap-sm">
      <Select
        name="category"
        value={value}
        defaultValue={defaultValue}
        onValueChange={onChange}
        disabled={disabled || vm.loading || Boolean(vm.error)}
      >
        <SelectTrigger id={id} aria-label="栏目" onFocus={onFocus}>
          <SelectValue placeholder={vm.loading ? '正在读取栏目' : '请选择栏目'} />
        </SelectTrigger>
        <SelectContent>
          {vm.categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              <CategoryBadge category={category} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {vm.error && <Failure error={vm.error} retry={() => void vm.load()} />}
    </div>
  );
}
