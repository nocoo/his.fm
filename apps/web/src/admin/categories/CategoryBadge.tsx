import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import {
  BookOpen,
  BriefcaseBusiness,
  Code,
  Coffee,
  Compass,
  Headphones,
  Heart,
  Leaf,
  Lightbulb,
  MessagesSquare,
  Mic,
  Sparkles,
} from 'lucide-react';
import './categories.css';
import type { PublicCategory } from '../../shared/category';

export const categoryIconComponents = {
  'briefcase-business': BriefcaseBusiness,
  'book-open': BookOpen,
  leaf: Leaf,
  'messages-square': MessagesSquare,
  mic: Mic,
  code: Code,
  lightbulb: Lightbulb,
  coffee: Coffee,
  compass: Compass,
  heart: Heart,
  headphones: Headphones,
  sparkles: Sparkles,
};
export function CategoryBadge({ category }: { category: PublicCategory }) {
  const Icon = categoryIconComponents[category.icon];
  return (
    <span className="category-badge">
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <TagBadge name={category.name} color={category.color} />
    </span>
  );
}
