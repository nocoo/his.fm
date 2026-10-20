import { Badge, Button, Input, LayerCard, Switch } from '@nocoo/basalt';
import { Collapsible, CollapsibleContent } from '@nocoo/basalt/components/collapsible';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select';
import { ToggleGroup, ToggleGroupItem } from '@nocoo/basalt/components/toggle-group';
import { BookOpen, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import { AudioPlayer } from '../../components/AudioPlayer';
import {
  type VoiceGender,
  type VoicePreviewFilters,
  type VoicePreviewVoice,
  type VoiceProvider,
  voiceGenderLabels,
  voicePreviewCatalog,
  voicePreviewMediaUrl,
  voicePreviewResults,
  voicePreviewSampleScript,
  voiceProviderInfo,
  voiceProviders,
} from '../../shared/voice-samples';
import { ProviderMark } from './ProviderMark';
import { useReferenceSample } from './useReferenceSample';

const catalog = voicePreviewCatalog();

function VoiceSampleCard({ entry, technical }: { entry: VoicePreviewVoice; technical: boolean }) {
  const info = voiceProviderInfo[entry.provider];
  const sample = useReferenceSample(voicePreviewMediaUrl(entry.objectKey));
  return (
    <LayerCard
      className="appearance-voice-card"
      data-provider={entry.provider}
      data-gender={entry.gender}
      data-voice={entry.voiceName}
      padding="none"
    >
      <div className="voice-sample-heading">
        <h2 className="voice-sample-name">{entry.voiceName}</h2>
        <div className="voice-sample-provider">
          <span className="voice-provider-label">
            <ProviderMark provider={entry.provider} />
            {info.name}
          </span>
          <span className="voice-model-label">{info.model}</span>
        </div>
      </div>
      <div className="voice-sample-meta">
        <div className="voice-sample-tags">
          <Badge variant={null} className="voice-tag voice-gender-tag">
            {voiceGenderLabels[entry.gender]}
          </Badge>
          {entry.traits.map((trait, index) => (
            <Badge
              key={trait}
              variant={null}
              className={`voice-tag ${entry.provider !== 'gemini' && index === 0 ? 'voice-locale-tag' : 'voice-style-tag'}`}
            >
              {trait}
            </Badge>
          ))}
        </div>
        <span className="voice-sample-duration">{entry.durationSeconds.toFixed(1)} 秒</span>
      </div>
      {sample.status === 'available' ? (
        <AudioPlayer src={sample.playbackUrl} title={entry.voiceName} compact hideIdleStatus preload="none" />
      ) : (
        <div className="voice-reference-state">
          {sample.status === 'loading' ? (
            <span role="status">
              <LoaderCircle size={14} aria-hidden="true" />
              正在检查参考样片…
            </span>
          ) : (
            <>
              <span role="alert">
                {sample.status === 'missing' ? '尚未上传样片' : '参考样片检查失败，请重试。'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={sample.retry}
                aria-label={`重试检查 ${entry.voiceName} 样片`}
              >
                <RotateCcw size={14} aria-hidden="true" />
                重试
              </Button>
            </>
          )}
        </div>
      )}
      {technical && (
        <div className="voice-technical">
          <code>{entry.voiceId}</code>
          <code>{entry.objectKey}</code>
        </div>
      )}
    </LayerCard>
  );
}

export function VoicePreviewContent() {
  const [filters, setFilters] = useState<VoicePreviewFilters>({ provider: 'all', gender: 'all', query: '' });
  const [scriptOpen, setScriptOpen] = useState(false);
  const [technical, setTechnical] = useState(false);
  const { filtered, matchingCount, providerCounts, genderOptions } = voicePreviewResults(catalog, filters);

  function selectProvider(provider: string) {
    if (provider) setFilters((current) => ({ ...current, provider: provider as VoiceProvider | 'all' }));
  }

  function selectGender(gender: string) {
    if (gender) setFilters((current) => ({ ...current, gender: gender as VoiceGender | 'all' }));
  }

  return (
    <section className="admin-page voice-preview-page voice-preview-catalog" aria-label="全部音色预览">
      <PageHeader
        title="音色预览"
        description="同一段文稿，听出不同表达。"
        actions={
          <Button
            variant="outline"
            size="sm"
            aria-expanded={scriptOpen}
            aria-controls="voice-fixed-script"
            onClick={() => setScriptOpen(!scriptOpen)}
          >
            <BookOpen size={15} aria-hidden="true" />
            固定文稿
            {scriptOpen ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
          </Button>
        }
      />
      <Collapsible open={scriptOpen} onOpenChange={setScriptOpen}>
        <CollapsibleContent unstyled id="voice-fixed-script">
          <LayerCard className="voice-script-card">
            <strong>所有样片共用的固定文稿</strong>
            <div className="voice-script-body">{voicePreviewSampleScript}</div>
            <p className="voice-script-note">
              这是音色对比测试文稿，不代表实时新闻。所有样片均在站外生成，本站仅供试听。
            </p>
          </LayerCard>
        </CollapsibleContent>
      </Collapsible>
      <div className="voice-catalog-toolbar">
        <div className="voice-catalog-pills">
          <ToggleGroup
            type="single"
            value={filters.provider}
            onValueChange={selectProvider}
            aria-label="按厂商筛选"
          >
            <ToggleGroupItem value="all">
              全部 <span className="voice-filter-count">{catalog.length}</span>
            </ToggleGroupItem>
            {voiceProviders.map((provider) => (
              <ToggleGroupItem key={provider} value={provider}>
                <ProviderMark provider={provider} />
                {voiceProviderInfo[provider].name}
                <span className="voice-filter-count">{providerCounts[provider]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={filters.gender}
            onValueChange={selectGender}
            aria-label="按性别筛选"
          >
            <ToggleGroupItem value="all">
              全部声线 <span className="voice-filter-count">{matchingCount}</span>
            </ToggleGroupItem>
            {genderOptions.map(({ gender, count }) => (
              <ToggleGroupItem key={gender} value={gender} data-gender={gender}>
                <span className="voice-gender-dot" aria-hidden="true" />
                {voiceGenderLabels[gender]}
                <span className="voice-filter-count">{count}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="voice-catalog-selects">
          <Select value={filters.provider} onValueChange={selectProvider}>
            <SelectTrigger aria-label="按厂商筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="voice-preview-options">
              <SelectItem value="all">全部厂商 · {catalog.length}</SelectItem>
              {voiceProviders.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  <span className="voice-filter-option">
                    <ProviderMark provider={provider} />
                    {voiceProviderInfo[provider].name}
                    <span className="voice-filter-count">{providerCounts[provider]}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.gender} onValueChange={selectGender}>
            <SelectTrigger aria-label="按性别筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="voice-preview-options">
              <SelectItem value="all">全部声线 · {matchingCount}</SelectItem>
              {genderOptions.map(({ gender, count }) => (
                <SelectItem key={gender} value={gender}>
                  <span className="voice-filter-option" data-gender={gender}>
                    <span className="voice-gender-dot" aria-hidden="true" />
                    {voiceGenderLabels[gender]}
                    <span className="voice-filter-count">{count}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="voice-search-field">
          <Search size={15} aria-hidden="true" />
          <Input
            aria-label="搜索音色"
            placeholder="搜索音色、风格…"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          />
        </div>
      </div>
      <div className="voice-catalog-context">
        <p className="voice-sample-results" aria-live="polite">
          {filtered.length} 个音色
        </p>
        <label className="voice-technical-toggle" htmlFor="voice-technical-information">
          <Switch
            id="voice-technical-information"
            checked={technical}
            onCheckedChange={setTechnical}
            aria-label="显示技术信息"
          />
          <span>技术信息</span>
        </label>
      </div>
      {filtered.length === 0 ? (
        <LayerCard className="voice-empty-results">
          <Search size={24} aria-hidden="true" />
          <strong>没有匹配的音色</strong>
          <p>换个名称、风格或声线试试。</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilters({ provider: 'all', gender: 'all', query: '' })}
          >
            清除筛选
          </Button>
        </LayerCard>
      ) : (
        <div className="voice-unified-grid">
          {filtered.map((entry) => (
            <VoiceSampleCard key={entry.objectKey} entry={entry} technical={technical} />
          ))}
        </div>
      )}
    </section>
  );
}
