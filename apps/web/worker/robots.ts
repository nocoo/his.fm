export function buildRobotsTxt(origin: string) {
  return `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}
