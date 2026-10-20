import { Badge } from '@nocoo/basalt';
import {
  type VoicePreviewEntry,
  voicePreviewDescriptorBadges,
  voicePreviewUsageLabel,
} from '../../shared/voice-samples';
import { type VoicePreviewBadgeTone, voicePreviewBadgeStyleTones } from './voice-preview-badge-colors';

const GENDER_TONE: Record<VoicePreviewEntry['gender'], VoicePreviewBadgeTone> = {
  男声: 'gender-male',
  女声: 'gender-female',
};

const USAGE_TONE: Record<string, VoicePreviewBadgeTone> = {
  learning: 'usage-learning',
  'manager-notes': 'usage-manager-notes',
};

function styleTone(index: number): VoicePreviewBadgeTone {
  return voicePreviewBadgeStyleTones[index % voicePreviewBadgeStyleTones.length] ?? 'style-slate';
}

function badgeClass(tone: VoicePreviewBadgeTone) {
  return `appearance-voice-badge appearance-voice-badge--${tone}`;
}

export function VoicePreviewBadges({ entry }: { entry: VoicePreviewEntry }) {
  const usageLabel = voicePreviewUsageLabel(entry);
  const descriptors = voicePreviewDescriptorBadges(entry);

  return (
    <div className="appearance-voice-badges">
      <Badge className={badgeClass(GENDER_TONE[entry.gender])}>{entry.gender}</Badge>
      {usageLabel && entry.usageCategoryId ? (
        <Badge className={badgeClass(USAGE_TONE[entry.usageCategoryId] ?? 'style-slate')}>{usageLabel}</Badge>
      ) : null}
      {descriptors.map((label, index) => (
        <Badge key={label} className={badgeClass(styleTone(index))}>
          {label}
        </Badge>
      ))}
    </div>
  );
}
