/**
 * Curated set of brand logos from simple-icons, targeted at developer
 * audience. Tree-shakeable: each brand is an explicit named import so only
 * the icons we reference ship in the renderer bundle.
 *
 * Values are simple-icons's canonical slugs (kebab-ish, lowercase). If you
 * want to add a brand, look it up at https://simpleicons.org — the URL slug
 * maps directly to the name used here.
 */

import {
  // Languages (brands that have official logos in simple-icons; "Java" is
  // represented by OpenJDK as a proxy since Java itself is gone from the
  // library due to Oracle trademark)
  siTypescript, siJavascript, siPython, siRust, siGo, siRuby, siPhp, siOpenjdk,
  siKotlin, siSwift, siDart, siElixir, siErlang, siScala, siClojure, siHaskell,
  siLua, siPerl, siR, siOcaml, siZig, siNim, siCrystal, siJulia,
  // Runtimes & frameworks
  siNodedotjs, siDeno, siBun, siReact, siVuedotjs, siAngular, siSvelte, siSolid,
  siNextdotjs, siNuxt, siRemix, siAstro, siQwik, siEmberdotjs, siBackbonedotjs, siRedux,
  siNestjs, siExpress, siFastapi, siFlask, siDjango, siSpring, siRubyonrails, siLaravel,
  siSymfony, siPhoenixframework,
  // Build tools & bundlers
  siWebpack, siVite, siEsbuild, siRollupdotjs, siTurborepo, siBabel, siSwc,
  siPnpm, siYarn, siNpm,
  // Styling
  siTailwindcss, siSass, siLess, siStyledcomponents, siPostcss, siMaterialdesign, siStorybook,
  // Databases (Apache Cassandra stands in for "Cassandra"; Neo4j uses camelCase slug)
  siPostgresql, siMysql, siSqlite, siMongodb, siRedis, siSupabase, siPrisma, siFirebase,
  siElasticsearch, siApachecassandra, siCockroachlabs, siClickhouse, siDuckdb, siNeo4j,
  // Cloud & infra
  siDocker, siKubernetes, siHelm, siTerraform, siAnsible, siNginx, siGooglecloud,
  siVercel, siNetlify, siCloudflare, siDigitalocean, siRailway,
  // DevOps & CI
  siGit, siGithub, siGitlab, siBitbucket, siGithubactions, siJenkins, siCircleci, siBuildkite,
  siSentry, siDatadog, siGrafana, siPrometheus,
  // AI / ML (OpenAI, Slack, Heroku, Windows were dropped from simple-icons due
  // to brand policy — Anthropic and others remain)
  siAnthropic, siHuggingface, siPytorch, siTensorflow, siPandas, siNumpy, siJupyter,
  siOllama,
  // Editors / tools
  siVim, siNeovim, siGnuemacs, siSublimetext, siIterm2, siAlacritty, siObsidian,
  siNotion, siLinear, siFigma, siDiscord, siZoom,
  // OS & browsers
  siLinux, siUbuntu, siDebian, siArchlinux, siNixos, siApple, siAndroid,
  siFirefox, siSafari, siBrave, siArc,
} from "simple-icons";
import type { SimpleIcon } from "simple-icons";

/** Grouped brand sets — renderable in order so browsing feels curated. */
export const SIMPLE_ICON_GROUPS: readonly { label: string; icons: readonly SimpleIcon[] }[] = [
  {
    label: "Languages",
    icons: [
      siTypescript, siJavascript, siPython, siRust, siGo, siRuby, siPhp, siOpenjdk,
      siKotlin, siSwift, siDart, siElixir, siErlang, siScala, siClojure, siHaskell,
      siLua, siPerl, siR, siOcaml, siZig, siNim, siCrystal, siJulia,
    ],
  },
  {
    label: "Runtimes & frameworks",
    icons: [
      siNodedotjs, siDeno, siBun, siReact, siVuedotjs, siAngular, siSvelte, siSolid,
      siNextdotjs, siNuxt, siRemix, siAstro, siQwik, siEmberdotjs, siBackbonedotjs, siRedux,
      siNestjs, siExpress, siFastapi, siFlask, siDjango, siSpring, siRubyonrails, siLaravel,
      siSymfony, siPhoenixframework,
    ],
  },
  {
    label: "Build tools",
    icons: [
      siWebpack, siVite, siEsbuild, siRollupdotjs, siTurborepo, siBabel, siSwc,
      siPnpm, siYarn, siNpm,
    ],
  },
  {
    label: "Styling",
    icons: [
      siTailwindcss, siSass, siLess, siStyledcomponents, siPostcss, siMaterialdesign, siStorybook,
    ],
  },
  {
    label: "Databases",
    icons: [
      siPostgresql, siMysql, siSqlite, siMongodb, siRedis, siSupabase, siPrisma, siFirebase,
      siElasticsearch, siApachecassandra, siCockroachlabs, siClickhouse, siDuckdb, siNeo4j,
    ],
  },
  {
    label: "Cloud & infra",
    icons: [
      siDocker, siKubernetes, siHelm, siTerraform, siAnsible, siNginx, siGooglecloud,
      siVercel, siNetlify, siCloudflare, siDigitalocean, siRailway,
    ],
  },
  {
    label: "DevOps & CI",
    icons: [
      siGit, siGithub, siGitlab, siBitbucket, siGithubactions, siJenkins, siCircleci, siBuildkite,
      siSentry, siDatadog, siGrafana, siPrometheus,
    ],
  },
  {
    label: "AI / ML",
    icons: [
      siAnthropic, siHuggingface, siPytorch, siTensorflow, siPandas, siNumpy, siJupyter,
      siOllama,
    ],
  },
  {
    label: "Editors & tools",
    icons: [
      siVim, siNeovim, siGnuemacs, siSublimetext, siIterm2, siAlacritty, siObsidian,
      siNotion, siLinear, siFigma, siDiscord, siZoom,
    ],
  },
  {
    label: "OS & browsers",
    icons: [
      siLinux, siUbuntu, siDebian, siArchlinux, siNixos, siApple, siAndroid,
      siFirefox, siSafari, siBrave, siArc,
    ],
  },
];

/** Flat slug → SimpleIcon lookup for O(1) resolution at render time. */
export const SIMPLE_ICON_BY_SLUG: Record<string, SimpleIcon> = (() => {
  const map: Record<string, SimpleIcon> = {};
  for (const group of SIMPLE_ICON_GROUPS) {
    for (const icon of group.icons) map[icon.slug] = icon;
  }
  return map;
})();

/** Resolve a simple-icons slug to its icon record, or undefined if unknown. */
export function resolveSimpleIcon(slug: string): SimpleIcon | undefined {
  return SIMPLE_ICON_BY_SLUG[slug];
}

/** Flat list of all curated slugs — used by the picker. */
export const SIMPLE_ICON_SLUGS: readonly string[] = Object.keys(SIMPLE_ICON_BY_SLUG);
