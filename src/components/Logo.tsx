type LogoProps = {
  className?: string;
  title?: string;
};

export function RunnerLogo({ className = "logo-run", title = "달리는 사람" }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="40" cy="11" r="6" fill="currentColor" />
      <path
        fill="currentColor"
        d="M34.2 17.4c2.4 3.6 6.6 6.2 8.8 7.2l-2.2 4.4c-3.2-1.2-7.1-4.1-9.4-7.4L18 24.2l-1.8-4.4 16.4-2.4h1.6Zm2.6 13.2 6.8 6.2 7.6-3.2 1.8 4.2-10 4.4-8.2-7.2-4.6 14.6H24l5.2-16.6 7.6-2.4ZM20.6 31.2l-9.2 8.4 2.8 3.2 8.4-7.6-2-4Zm8.8 20.2-8.6 6.2 2.4 3.4 10.2-7.2-4-2.4Z"
      />
    </svg>
  );
}
