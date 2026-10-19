import { Badge, Button, LayerCard } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Radio, RadioGroup } from '@nocoo/basalt/components/radio';
import { ArrowUpRight, Check, Eye, RefreshCw } from 'lucide-react';
import { BrandLockup } from '../../brand/BrandLockup';
import { themeCoverFrameSrc, themeMedia, themeStyle, themes } from '../../brand/themes';
import { themeIdSchema, themeIds } from '../../shared/appearance';
import { getEnvironment } from '../environment';
import { Failure } from '../production/controls';
import { ThemeCoverPreview } from './ThemeCoverPreview';
import { useAppearancePreviews } from './useAppearancePreviews';
import { useAppearanceSettings } from './useAppearanceSettings';
import './appearance.css';

export default function AppearancePage() {
  const vm = useAppearanceSettings();
  const covers = useAppearancePreviews();
  const website = import.meta.env.DEV && getEnvironment() === 'production' ? 'https://his.fm' : '';
  return (
    <div className="admin-page appearance-page">
      <PageHeader
        title="品牌外观"
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
      {!vm.saved && !vm.error && <LayerCard.Loading label="正在读取品牌外观" />}
      {vm.saved && (
        <>
          <LayerCard className="appearance-identity" padding="md">
            <div
              className="identity-specimen"
              style={themeStyle(vm.saved.theme)}
              role="img"
              aria-label="his.fm 后接括号，暗喻函数调用"
            >
              <BrandLockup />
            </div>
            <div>
              <strong>一套 ID，八种风景。</strong>
              <p className="admin-muted">
                his.fm 后接一对括号，暗喻程序中的 func()。字形与间距统一，主题决定配色、主视觉和构图。
              </p>
            </div>
            <div className="identity-downloads">
              <a href="/brand/logo.svg" download>
                字标 SVG <ArrowUpRight size={13} />
              </a>
              <a href="/brand/symbol.svg" download>
                符号 SVG <ArrowUpRight size={13} />
              </a>
              <a href={themeCoverFrameSrc(vm.selected ?? vm.saved?.theme ?? 'interval')} download>
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
          <LayerCard className="appearance-preview-controls" padding="md">
            <div>
              <strong>近期节目 · 主题预览</strong>
              <p className="admin-muted">自动展示节目库最近 4 期封面，横向滑动对比每种主题的叠加效果。</p>
            </div>
            <Button variant="outline" size="sm" loading={covers.loading} onClick={() => void covers.load()}>
              <RefreshCw size={14} /> 刷新预览
            </Button>
            {covers.error && (
              <p className="admin-error" role="alert">
                {covers.error}
              </p>
            )}
          </LayerCard>
          {vm.conflict && (
            <LayerCard className="appearance-conflict">
              <p>已有新的外观设置。你的选择仍保留，请读取最新设置后重新选择。</p>
              <Button variant="outline" loading={vm.pending} onClick={() => void vm.reload()}>
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
                  <label className="appearance-theme-label" htmlFor={`appearance-${id}`}>
                    <div
                      className="appearance-mini"
                      data-theme={id}
                      style={themeStyle(id)}
                      aria-hidden="true"
                    >
                      <img
                        src={themeMedia[id].hero}
                        srcSet={themeMedia[id].srcSet}
                        sizes="(max-width: 760px) calc(100vw - 72px), (max-width: 1199px) calc((100vw - 96px) / 2), calc((100vw - 380px) / 2)"
                        alt={theme.imageAlt}
                        width={themeMedia[id].width}
                        height={themeMedia[id].height}
                        loading="lazy"
                      />
                      <BrandLockup />
                      <span className="mini-heading">{theme.designSlogan}</span>
                    </div>
                    <LayerCard.Body className="appearance-choice">
                      <Radio
                        id={`appearance-${id}`}
                        value={id}
                        aria-labelledby={`appearance-name-${id}`}
                        aria-describedby={`appearance-description-${id}`}
                      />
                      <strong id={`appearance-name-${id}`}>
                        {theme.number} · {theme.name}
                      </strong>
                      {vm.saved?.theme === id && (
                        <Badge variant="secondary" className="appearance-current">
                          使用中
                        </Badge>
                      )}
                      <span className="appearance-english">
                        {theme.english} · {theme.designStyle}
                      </span>
                    </LayerCard.Body>
                  </label>
                  <LayerCard.Body className="appearance-design-details">
                    <ul className="appearance-palette" aria-label={`${theme.name}配色`}>
                      {theme.palette.map((color, index) => (
                        <li key={color} title={`${theme.paletteNames[index]} ${color}`}>
                          <span style={{ background: color }} aria-hidden="true" />
                          <span>{theme.paletteNames[index]}</span>
                          <code>{color}</code>
                        </li>
                      ))}
                    </ul>
                    <div>
                      <span className="appearance-detail-label">设计思路</span>
                      <p id={`appearance-description-${id}`} className="appearance-description">
                        {theme.description}
                      </p>
                    </div>
                    <ThemeCoverPreview
                      name={theme.name}
                      themeId={id}
                      sources={covers.sources}
                      loading={covers.loading}
                      sourceError={covers.error}
                    />
                    <Button variant="outline" size="sm" asChild>
                      <a href={`${website}/?theme=${id}`} target="_blank" rel="noopener noreferrer">
                        <Eye size={14} /> 预览此主题网站 <ArrowUpRight size={14} />
                      </a>
                    </Button>
                  </LayerCard.Body>
                </LayerCard>
              );
            })}
          </RadioGroup>
          <p className="admin-muted appearance-note">
            设计说明与配色来自 docs/design/index.html，本站 ID
            采用当前统一规范。选择与预览均不保存；只有“应用到公开网站”会更改主题。
          </p>
        </>
      )}
    </div>
  );
}
