import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-accent to-accent-2 text-accent-ink border-transparent shadow-[0_8px_24px_-10px_var(--accent-2)] hover:brightness-110',
  secondary: 'bg-raised text-fg border-line-strong hover:border-accent-line',
  ghost:
    'bg-transparent text-muted border-transparent hover:text-fg hover:bg-accent-soft',
  danger: 'bg-danger text-[#1a0806] border-transparent hover:brightness-110',
};

export function buttonClass(
  variant: Variant = 'secondary',
  size: 'sm' | 'md' | 'lg' = 'md'
) {
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border font-medium',
    'transition-[filter,background-color,border-color,transform] duration-200 ease-out-expo',
    'active:translate-y-px active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
    size === 'sm' && 'h-8 px-3 text-[13px]',
    size === 'md' && 'h-10 px-4 text-sm',
    size === 'lg' && 'h-12 px-6 text-[15px]',
    VARIANTS[variant]
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      type={type}
      className={cn(buttonClass(variant, size), className)}
      {...props}
    />
  );
}

export function Panel({
  className,
  title,
  actions,
  children,
  tone,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: 'danger';
}) {
  return (
    <section
      className={cn(
        'panel p-5 sm:p-6',
        tone === 'danger' &&
          'border-[color-mix(in_srgb,var(--danger)_45%,var(--line))]',
        className
      )}
      {...props}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h2
              className={cn(
                'text-[15px] font-semibold tracking-tight',
                tone === 'danger' && 'text-danger'
              )}
            >
              {title}
            </h2>
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-fg mb-1.5 block text-[13px] font-medium', className)}
      {...props}
    />
  );
}

export function Help({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'text-muted mt-1.5 text-[12.5px] leading-relaxed',
        className
      )}
      {...props}
    />
  );
}

export function Check({
  label,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 py-1 text-sm',
        props.disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <input type="checkbox" className="size-4 shrink-0" {...props} />
      <span>{label}</span>
    </label>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';
const PILL: Record<Tone, string> = {
  neutral: 'border-line-strong text-muted',
  ok: 'border-[color-mix(in_srgb,var(--ok)_50%,transparent)] text-ok bg-[color-mix(in_srgb,var(--ok)_10%,transparent)]',
  warn: 'border-[color-mix(in_srgb,var(--warn)_50%,transparent)] text-warn bg-warn-soft',
  danger:
    'border-[color-mix(in_srgb,var(--danger)_50%,transparent)] text-danger bg-danger-soft',
  accent: 'border-accent-line text-accent bg-accent-soft',
};

export function Pill({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        PILL[tone],
        className
      )}
      {...props}
    />
  );
}

const NOTICE: Record<Exclude<Tone, 'accent'>, string> = {
  neutral: 'border-line bg-sunken text-muted',
  ok: 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_8%,transparent)]',
  warn: 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-soft',
  danger:
    'border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-danger-soft',
};

export function Notice({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: Exclude<Tone, 'accent'>;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const titleColor = {
    neutral: 'text-fg',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
  }[tone];
  return (
    <div
      className={cn(
        'rounded-[10px] border px-4 py-3 text-sm',
        NOTICE[tone],
        className
      )}
    >
      {title && <p className={cn('font-semibold', titleColor)}>{title}</p>}
      {children && (
        <div
          className={cn(
            'text-muted text-[13px] leading-relaxed',
            title && 'mt-1'
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-mono text-[13px] break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-line-strong bg-raised rounded-[5px] border border-b-2 px-1.5 py-px font-mono text-[0.8em]">
      {children}
    </kbd>
  );
}
