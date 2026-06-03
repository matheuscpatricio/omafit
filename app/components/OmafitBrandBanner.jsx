import { useAppI18n } from '../contexts/AppI18n';

/**
 * Faixa de marca Omafit (cores da landing omafit-widget).
 * @param {{ variant?: 'hero' | 'compact' }} props
 */
export function OmafitBrandBanner({ variant = 'compact' }) {
  const { t } = useAppI18n();
  const isHero = variant === 'hero';

  return (
    <header
      className={`omafit-brand-banner omafit-brand-banner--${isHero ? 'hero' : 'compact'}`}
      aria-label="Omafit"
    >
      <div className="omafit-brand-banner__inner">
        <img
          className="omafit-brand-banner__icon"
          src="/omafit-brand-icon.svg"
          alt=""
          width={isHero ? 48 : 36}
          height={isHero ? 48 : 36}
          decoding="async"
        />
        <div className="omafit-brand-banner__text">
          <span className="omafit-brand-banner__wordmark" aria-hidden="true">
            Oma<span className="omafit-brand-banner__wordmark-accent">fit</span>
          </span>
          <p className="omafit-brand-banner__tagline">{t('brand.tagline')}</p>
          {isHero ? (
            <p className="omafit-brand-banner__subtitle">{t('brand.subtitle')}</p>
          ) : null}
        </div>
        {isHero ? (
          <ul className="omafit-brand-banner__pills">
            <li className="omafit-brand-banner__pill omafit-brand-banner__pill--accent">
              {t('brand.pillTryOn')}
            </li>
            <li className="omafit-brand-banner__pill">{t('brand.pillReturns')}</li>
            <li className="omafit-brand-banner__pill">{t('brand.pillConversion')}</li>
          </ul>
        ) : null}
      </div>
    </header>
  );
}
