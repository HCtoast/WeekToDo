/** .sql 파일을 문자열로 번들에 포함시킨다 (vite ?raw). */
declare module '*.sql?raw' {
  const content: string
  export default content
}
