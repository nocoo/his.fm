import { PageHeader } from '@nocoo/basalt/components/page-header';
import { VoicePreviewContent } from './VoicePreview';
import './voice-preview.css';

export default function VoicePreviewPage() {
  return (
    <div className="admin-page voice-preview-page">
      <PageHeader title="音色预览" />
      <VoicePreviewContent />
    </div>
  );
}
