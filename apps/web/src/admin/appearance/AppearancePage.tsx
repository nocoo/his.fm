import { Badge, Button, LayerCard } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Radio, RadioGroup } from '@nocoo/basalt/components/radio';
import { ArrowUpRight, Check, Eye } from 'lucide-react';
import { BrandSymbol, Wordmark } from '../../brand/Brand';
import { themeMedia, themeStyle, themes } from '../../brand/themes';
import { themeIdSchema, themeIds } from '../../shared/appearance';
import { getEnvironment } from '../environment';
import { Failure } from '../production/controls';
import { useAppearanceSettings } from './useAppearanceSettings';
import './appearance.css';

export default function AppearancePage() {
  const vm = useAppearanceSettings();
  const website = import.meta.env.DEV && getEnvironment() === 'production' ? 'https://his.fm' : '';
  return (
    <div className="admin-page appearance-page">
      <PageHeader
        title="网站外观"
        actions={
          <>
            {vm.selected && (
              <Button variant="outline" asChild>
                <a href={`${website}/?theme=${vm.selected}`} target="_blank" rel="noopener noreferrer">
                  <Eye size={16} />
                  预览所选风格
                </a>
              </Button>
            )}
            <Button disabled={!vm.dirty || vm.conflict} loading={vm.pending} onClick={() => void vm.save()}>
              <Check size={16} />
              应用到公开网站
            </Button>
          </>
        }
      />
      {vm.error && <Failure error={vm.error} retry={!vm.saved ? () => void vm.load() : undefined} />}
      {!vm.saved && !vm.error && <LayerCard.Loading label="正在读取网站外观" />}
      {vm.saved && (
        <>
          <LayerCard className="appearance-identity" padding="md">
            <div className="identity-specimen" role="img" aria-label="his.fm 统一字标与开口括号符号">
              <Wordmark />
              <BrandSymbol />
            </div>
            <div>
              <strong>一套 ID，八种风景。</strong>
              <p className="admin-muted">
                统一采用「间隙」字标、括号符号与 Space Grotesk / Noto Sans SC。主题决定配色、主视觉和构图。
              </p>
            </div>
            <div className="identity-downloads">
              <a href="/brand/logo.svg" download>
                字标 SVG <ArrowUpRight size={13} />
              </a>
              <a href="/brand/symbol.svg" download>
                符号 SVG <ArrowUpRight size={13} />
              </a>
              <a href="/brand/cover-frame.svg" download>
                透明框架 SVG <ArrowUpRight size={13} />
              </a>
            </div>
          </LayerCard>
          <div className="appearance-status" role="status">
            <span>
              当前使用：<strong>{themes[vm.saved.theme].name}</strong>
            </span>
            <span className="admin-muted">
              {vm.dirty ? '所选风格尚未应用' : '已保存 · 公开网站使用此风格'}
            </span>
          </div>
          {vm.conflict && (
            <LayerCard className="appearance-conflict">
              <p>已有新的外观设置。你的选择仍保留，请读取最新设置后重新选择。</p>
              <Button variant="outline" loading={vm.pending} onClick={() => void vm.load()}>
                读取最新设置
              </Button>
            </LayerCard>
          )}
          <RadioGroup
            className="appearance-options"
            value={vm.selected ?? ''}
            onValueChange={(value) => vm.setSelected(themeIdSchema.parse(value))}
            disabled={vm.pending}
            aria-label="网站视觉主题"
          >
            {themeIds.map((id) => {
              const theme = themes[id];
              return (
                <LayerCard
                  padding="none"
                  className="appearance-option"
                  key={id}
                  data-selected={vm.selected === id}
                >
                  <label htmlFor={`appearance-${id}`}>
                    <div
                      className="appearance-mini"
                      data-theme={id}
                      style={themeStyle(id)}
                      aria-hidden="true"
                    >
                      <img src={themeMedia[id].thumbnail} alt="" width={480} height={320} loading="lazy" />
                      <Wordmark />
                      <span className="mini-heading">
                        {theme.heading.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </span>
                      <BrandSymbol />
                    </div>
                    <div className="appearance-choice">
                      <Radio
                        id={`appearance-${id}`}
                        value={id}
                        aria-labelledby={`appearance-name-${id}`}
                        aria-describedby={`appearance-description-${id}`}
                      />
                      <div>
                        <strong id={`appearance-name-${id}`}>
                          {theme.number} · {theme.name}
                        </strong>
                        <span>{theme.english}</span>
                      </div>
                      {vm.saved?.theme === id && <Badge variant="secondary">使用中</Badge>}
                    </div>
                    <p id={`appearance-description-${id}`} className="appearance-description">
                      {theme.description}
                    </p>
                    <div className="appearance-swatches" aria-hidden="true">
                      {theme.palette.map((color) => (
                        <span key={color} style={{ background: color }} />
                      ))}
                    </div>
                  </label>
                </LayerCard>
              );
            })}
          </RadioGroup>
          <p className="admin-muted appearance-note">
            选择后可先预览，应用后所有访客使用同一风格。节目内容与已发布的封面原图保持完整。
          </p>
        </>
      )}
    </div>
  );
}
