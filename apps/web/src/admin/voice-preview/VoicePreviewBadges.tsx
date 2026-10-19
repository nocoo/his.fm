import { Badge } from '@nocoo/basalt';
import type { ComponentProps } from 'react';
import {
  type VoicePreviewEntry,
  voicePreviewDescriptorBadges,
  voicePreviewUsageLabel,
} from '../../shared/voice-samples';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const GENDER_VARIANT: Record<VoicePreviewEntry['gender'], BadgeVariant> = {
  男声: 'blue',
  女声: 'purple',
};

const USAGE_VARIANT: Record<string, BadgeVariant> = {
  learning: 'teal',
  'manager-notes': 'orange',
};

const STYLE_VARIANTS: BadgeVariant[] = ['teal', 'orange', 'red', 'blue', 'purple', 'default'];

function styleVariant(index: number): BadgeVariant {
  return STYLE_VARIANTS[index % STYLE_VARIANTS.length] ?? 'default';
}

export function VoicePreviewBadges({ entry }: { entry: VoicePreviewEntry }) {
  const usageLabel = voicePreviewUsageLabel(entry);
  const descriptors = voicePreviewDescriptorBadges(entry);

  return (
    <div className="appearance-voice-badges">
      <Badge variant={GENDER_VARIANT[entry.gender]}>{entry.gender}</Badge>
      {usageLabel && entry.usageCategoryId ? (
        <Badge variant={USAGE_VARIANT[entry.usageCategoryId] ?? 'default'}>{usageLabel}</Badge>
      ) : null}
      {descriptors.map((label, index) => (
        <Badge key={label} variant={styleVariant(index)}>
          {label}
        </Badge>
      ))}
    </div>
  );
}
