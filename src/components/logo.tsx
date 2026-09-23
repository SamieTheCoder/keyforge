import { useId } from 'react';
import { cn } from '@/lib/utils';

export const KEY_PATH =
  'M28 0H92L110 18V54L92 72H60V100H97V124H60V138H89V160H60V172Q60 180 52 180H41Q33 180 33 172V72H28L10 54V18ZM74 36A14 14 0 1 0 46 36A14 14 0 1 0 74 36Z';

/** Brand key mark with the teal mesh gradient. */
export function KeyMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 120 180"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <radialGradient
          id={`${id}a`}
          cx="60"
          cy="70"
          r="120"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#0d7377" />
          <stop offset="1" stopColor="#0d7377" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={`${id}b`}
          cx="112"
          cy="4"
          r="96"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#14ffec" />
          <stop offset=".36" stopColor="#00c9c7" />
          <stop offset="1" stopColor="#0d7377" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={`${id}c`}
          cx="8"
          cy="176"
          r="96"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#14ffec" />
          <stop offset=".34" stopColor="#00c9c7" />
          <stop offset="1" stopColor="#0d7377" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={KEY_PATH} fillRule="evenodd" fill="#0b5f62" />
      <path d={KEY_PATH} fillRule="evenodd" fill={`url(#${id}a)`} />
      <path d={KEY_PATH} fillRule="evenodd" fill={`url(#${id}b)`} />
      <path d={KEY_PATH} fillRule="evenodd" fill={`url(#${id}c)`} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <KeyMark className="h-7 w-auto" />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">
        keyforge
      </span>
    </span>
  );
}
