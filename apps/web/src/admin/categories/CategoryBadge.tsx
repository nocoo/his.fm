import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import './categories.css';
import type { PublicCategory } from '../../shared/category';
import { categoryIconComponents } from '../../shared/category-icons';
export function CategoryBadge({ category }: { category: PublicCategory }) {
  const Icon = categoryIconComponents[category.icon];
  return (
    <span className="category-badge">
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <TagBadge name={category.name} color={category.color} />
    </span>
  );
}
