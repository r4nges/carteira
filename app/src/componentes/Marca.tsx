interface Props {
  tamanho?: number
}

/** Logo: rosca de composição (branco e açafrão) sobre cobalto. As cores são fixas nos dois temas. */
export function Marca({ tamanho = 28 }: Props) {
  return (
    <svg class="marca" viewBox="0 0 64 64" width={tamanho} height={tamanho} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2335d9" />
      <path d="M32.58 16.49A15.52 15.52 0 0 1 46.93 36.24" fill="none" stroke="#f2a900" stroke-width="7.36" />
      <path d="M46.57 37.35A15.52 15.52 0 1 1 31.42 16.49" fill="none" stroke="#ffffff" stroke-width="7.36" />
    </svg>
  )
}
