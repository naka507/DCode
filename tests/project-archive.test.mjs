import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GROUP_LABEL_KEYS,
  GROUP_ORDER,
  INITIAL_VISIBLE_SESSION_COUNT,
  PROJECT_STATUS_LABEL_KEYS,
  SORT_MODES,
  buildProjectIndex,
  compareProjects,
  countProjectSessions,
  displayedProjectSessions,
  filterArchiveItems,
  formatUpdated,
  groupArchiveRows,
  neighborPath,
  nextArchiveOpenPath,
  projectBucket,
  projectMatchesQuery,
  projectRowId,
  projectStatus,
  relatedProjectSessions,
  sessionMatchesIndexProject,
  sessionMatchesQuery,
  sessionTimestamp,
  shortenPath,
} from "../src/renderer/lib/project-archive.ts";
import { loadStyles } from "./helpers/styles.mjs";

/**
 * The project archive's framework-free half: the index build, the row algebra
 * and the query predicates, all executed against the module.
 *
 * The last block covers the rendered markup and stylesheet. A Vue SFC's class
 * names are already walked by `tests/vue-class-contract.test.mjs`, so the
 * assertions here are the ones that test cannot make — that the carried-over
 * classes and their rules exist, not that they are defined somewhere.
 */

/* ---------- Pure functions ---------- */

test("shortenPath collapses a home prefix and leaves other paths alone", () => {
  assert.equal(shortenPath("/Users/me/app"), "~/app");
  assert.equal(shortenPath("/home/me/app"), "~/app");
  // A Windows path has no home prefix to collapse, and a nested `home` that is
  // not the first segment must not be touched either.
  assert.equal(shortenPath("C:\\work\\app"), "C:\\work\\app");
  assert.equal(shortenPath("/srv/home/me/app"), "/srv/home/me/app");
});

test("sessionTimestamp reads an ISO string and falls back to 0", () => {
  assert.equal(sessionTimestamp("2026-07-25T11:00:00.000Z"), Date.parse("2026-07-25T11:00:00.000Z"));
  assert.equal(sessionTimestamp(""), 0);
  assert.equal(sessionTimestamp("not a date"), 0);
});

test("formatUpdated renders a relative minute, an absolute date, and the never label", () => {
  const now = Date.now();
  assert.equal(formatUpdated(undefined, "en", "never"), "never");
  assert.equal(formatUpdated(0, "en", "never"), "never");
  // Five minutes ago is inside the relative window (a week).
  assert.equal(formatUpdated(now - 5 * 60_000, "en", "never"), "5 minutes ago");
  // Forty days ago is outside it, so the absolute date is used. Assert the
  // year-less shape rather than a locale-formatted literal.
  const fortyDays = formatUpdated(now - 40 * 24 * 60 * 60_000, "en", "never");
  assert.notEqual(fortyDays, "never");
  assert.match(fortyDays, /\d/, "an absolute date carries a day number");
  assert.doesNotMatch(fortyDays, /ago$/, "an absolute date is not a relative one");
});

test("projectBucket puts archived ahead of pinned", () => {
  const base = { path: "/w/a", name: "a", openedAt: 0 };
  assert.equal(projectBucket({ ...base, groupId: "g", roots: [], legacy: false, pinned: true }), "pinned");
  assert.equal(
    projectBucket({ ...base, groupId: "g", roots: [], legacy: false, archived: true }),
    "archived",
  );
  assert.equal(
    projectBucket({
      ...base,
      groupId: "g",
      roots: [],
      legacy: false,
      pinned: true,
      archived: true,
    }),
    "archived",
    "an archived record can never read as pinned",
  );
  assert.equal(projectBucket({ ...base, groupId: "g", roots: [], legacy: false }), "projects");
});

test("projectStatus ranks archived above active above open", () => {
  const project = { path: "/w/a", archived: false };
  assert.equal(
    projectStatus({ project: { ...project, archived: true }, openProjectPaths: [] }),
    "archived",
  );
  assert.equal(
    projectStatus({ project, workspacePath: "/w/a", openProjectPaths: [] }),
    "active",
  );
  assert.equal(
    projectStatus({ project, workspacePath: "/w/other", openProjectPaths: ["/w/a/"] }),
    "open",
  );
  assert.equal(projectStatus({ project, workspacePath: "/w/other", openProjectPaths: [] }), null);
  // Archived outranks a matching live workspace.
  assert.equal(
    projectStatus({
      project: { path: "/w/a", archived: true },
      workspacePath: "/w/a",
      openProjectPaths: ["/w/a"],
    }),
    "archived",
  );
});

test("nextArchiveOpenPath opens any other row and closes the open one", () => {
  assert.equal(nextArchiveOpenPath(null, "/w/a"), "/w/a");
  assert.equal(nextArchiveOpenPath("/w/a", "/w/b"), "/w/b");
  assert.equal(nextArchiveOpenPath("/w/a", "/w/a"), null);
});

test("compareProjects sorts by name and by recency, breaking ties on path", () => {
  const a = { path: "/w/a", name: "Beta", openedAt: 10 };
  const b = { path: "/w/b", name: "Alpha", openedAt: 20 };
  assert.ok(compareProjects(a, b, "name") > 0, "Beta follows Alpha by name");
  assert.ok(compareProjects(a, b, "recent") > 0, "the older record follows the newer");
  const c = { path: "/w/c", name: "Beta", openedAt: 10 };
  assert.ok(compareProjects(a, c, "name") < 0, "equal names fall back to the path");
  assert.ok(compareProjects(a, c, "recent") < 0, "equal times fall back to the path");
});

test("groupArchiveRows orders pinned, projects, archived and drops empty groups", () => {
  const row = (path, extra = {}) => ({
    path,
    name: path.slice(3),
    openedAt: 1,
    groupId: "g",
    roots: [],
    legacy: false,
    ...extra,
  });
  const groups = groupArchiveRows(
    [row("/w/plain"), row("/w/archived", { archived: true }), row("/w/pinned", { pinned: true })],
    "recent",
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ["pinned", "projects", "archived"],
  );
  assert.deepEqual(
    groups.map((group) => group.rows.map((item) => item.path)),
    [["/w/pinned"], ["/w/plain"], ["/w/archived"]],
  );
  // An empty bucket produces no section at all, so the index has no bare label.
  assert.deepEqual(
    groupArchiveRows([row("/w/plain")], "recent").map((group) => group.id),
    ["projects"],
  );
  assert.deepEqual(groupArchiveRows([], "recent"), []);
});

test("countProjectSessions counts a session in any root of its project", () => {
  const project = {
    path: "/w/a",
    name: "a",
    openedAt: 0,
    groupId: "g",
    legacy: false,
    roots: [
      { path: "/w/a", name: "a", position: 0 },
      { path: "/w/a-extra", name: "a-extra", position: 1 },
    ],
  };
  const other = { ...project, path: "/w/b", name: "b", roots: [{ path: "/w/b", name: "b", position: 0 }] };
  const sessions = [
    { id: "s1", title: "one", projectPath: "/w/a", createdAt: "", updatedAt: "" },
    // A root that is not the project's primary path still belongs to it.
    { id: "s2", title: "two", projectPath: "/w/a-extra/", createdAt: "", updatedAt: "" },
    { id: "s3", title: "three", projectPath: "/w/b", createdAt: "", updatedAt: "" },
    { id: "s4", title: "four", projectPath: null, createdAt: "", updatedAt: "" },
  ];
  const counts = countProjectSessions([project, other], sessions);
  assert.equal(counts.get("/w/a"), 2);
  assert.equal(counts.get("/w/b"), 1);
  assert.equal(sessionMatchesIndexProject(sessions[3], project), false, "a path-less session belongs to none");
});

test("filterArchiveItems keeps a project a matching session title points at", () => {
  const project = {
    path: "/w/a",
    name: "Alpha",
    openedAt: 0,
    groupId: "g",
    legacy: false,
    roots: [{ path: "/w/a", name: "a", position: 0 }],
  };
  const other = { ...project, path: "/w/b", name: "Beta", roots: [{ path: "/w/b", name: "b", position: 0 }] };
  const sessions = [
    { id: "s1", title: "Fix the login flow", projectPath: "/w/a", createdAt: "", updatedAt: "" },
    { id: "s2", title: "Unrelated", projectPath: "/w/b", createdAt: "", updatedAt: "" },
  ];
  const items = [project, other];
  // No query keeps every row.
  assert.deepEqual(filterArchiveItems(items, sessions, "  ").map((item) => item.path), [
    "/w/a",
    "/w/b",
  ]);
  // A name match keeps its own project only.
  assert.deepEqual(filterArchiveItems(items, sessions, "beta").map((item) => item.path), ["/w/b"]);
  // A *session title* match keeps the project that session belongs to.
  assert.deepEqual(filterArchiveItems(items, sessions, "login").map((item) => item.path), [
    "/w/a",
  ]);
  // A session title that belongs to no project matches nothing.
  assert.deepEqual(filterArchiveItems(items, sessions, "nothing here"), []);
  assert.equal(projectMatchesQuery(project, "  "), true);
  assert.equal(projectMatchesQuery(project, "alpha"), true);
  assert.equal(projectMatchesQuery(project, "w/a"), true);
  assert.equal(projectMatchesQuery(project, "zzz"), false);
});

test("relatedProjectSessions orders by updated, created, title, then id", () => {
  const project = {
    path: "/w/a",
    name: "a",
    openedAt: 0,
    groupId: "g",
    legacy: false,
    roots: [{ path: "/w/a", name: "a", position: 0 }],
  };
  const session = (id, title, updatedAt, createdAt, projectPath = "/w/a") => ({
    id,
    title,
    projectPath,
    createdAt,
    updatedAt,
  });
  const ordered = relatedProjectSessions(
    [
      session("b", "Same", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"),
      session("a", "Same", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"),
      session("c", "Zeta", "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"),
      session("d", "Other", "2026-01-05T00:00:00Z", "2026-01-01T00:00:00Z"),
      // A session of another project is not related and must not be returned.
      session("e", "Nope", "2026-01-09T00:00:00Z", "2026-01-01T00:00:00Z", "/w/b"),
    ],
    project,
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["d", "c", "a", "b"],
    "updated desc, then created desc, then title, then id",
  );
});

test("displayedProjectSessions narrows to the matching sessions on a session-only match", () => {
  const project = {
    path: "/w/a",
    name: "Alpha",
    openedAt: 0,
    groupId: "g",
    legacy: false,
    roots: [{ path: "/w/a", name: "a", position: 0 }],
  };
  const sessions = [
    { id: "s1", title: "Fix login", projectPath: "/w/a", createdAt: "", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "s2", title: "Ship release", projectPath: "/w/a", createdAt: "", updatedAt: "2026-01-02T00:00:00Z" },
  ];
  // A project-name match shows every related session.
  const byProject = displayedProjectSessions(sessions, project, "alpha");
  assert.equal(byProject.sessionSearchMatch, false);
  assert.deepEqual(byProject.displayed.map((item) => item.id), ["s2", "s1"]);
  assert.equal(byProject.related.length, 2);
  // A query that only matches one session narrows the card to that session.
  const bySession = displayedProjectSessions(sessions, project, "login");
  assert.equal(bySession.sessionSearchMatch, true);
  assert.deepEqual(bySession.displayed.map((item) => item.id), ["s1"]);
  assert.equal(bySession.related.length, 2, "the related list is still the whole project");
  // An empty query matches every project, so nothing is narrowed.
  const empty = displayedProjectSessions(sessions, project, "");
  assert.equal(empty.sessionSearchMatch, false);
  assert.equal(empty.displayed.length, 2);
  assert.equal(sessionMatchesQuery(sessions[0], ""), true);
  assert.equal(sessionMatchesQuery(sessions[0], "S1"), true, "the id is searched too");
});

test("neighborPath steps, clamps, and lands on the first row with no current one", () => {
  const rows = [{ path: "/w/a" }, { path: "/w/b" }, { path: "/w/c" }];
  assert.equal(neighborPath(rows, "/w/a", 1), "/w/b");
  assert.equal(neighborPath(rows, "/w/b", -1), "/w/a");
  // Clamped at both ends.
  assert.equal(neighborPath(rows, "/w/c", 1), "/w/c");
  assert.equal(neighborPath(rows, "/w/a", -1), "/w/a");
  // No current row: the first press lands on the first row whichever way it
  // points, so an arrow key always has somewhere to go.
  assert.equal(neighborPath(rows, null, 1), "/w/a");
  assert.equal(neighborPath(rows, null, -1), "/w/a");
  // A row that is no longer in the filtered list behaves the same way.
  assert.equal(neighborPath(rows, "/w/gone", 1), "/w/a");
  assert.equal(neighborPath([], null, 1), null);
});

/* ---------- buildProjectIndex ---------- */

const recent = (path, name, openedAt, extra = {}) => ({ path, name, openedAt, ...extra });

test("a durable group wins over a matching recent and absorbs its openedAt", () => {
  const items = buildProjectIndex({
    durableProjects: [
      {
        id: "group-1",
        name: "Group",
        primaryPath: "/w/a",
        roots: [{ path: "/w/a", name: "a", position: 0 }],
        lastOpenedAt: 100,
        pinned: false,
      },
    ],
    recents: [recent("/w/a", "Recent", 500)],
    sessionProjects: [],
    projectMeta: {},
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].groupId, "group-1");
  assert.equal(items[0].name, "Group", "the durable name wins");
  assert.equal(items[0].openedAt, 500, "the newer recent time is absorbed");
  assert.equal(items[0].legacy, false);
});

test("a recent with no group becomes a legacy group with one root at position 0", () => {
  const items = buildProjectIndex({
    durableProjects: [],
    recents: [recent("/w/solo", "Solo", 42)],
    sessionProjects: [],
    projectMeta: {},
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].groupId, "legacy:/w/solo");
  assert.deepEqual(items[0].roots, [{ path: "/w/solo", name: "Solo", position: 0 }]);
  assert.equal(items[0].legacy, true);
  assert.equal(items[0].openedAt, 42);
});

test("projectMeta overrides name, pinned and archived", () => {
  const items = buildProjectIndex({
    durableProjects: [],
    recents: [recent("/w/a", "Original", 10, { pinned: true })],
    sessionProjects: [],
    projectMeta: { "/w/a": { name: "Renamed", pinned: false, archived: true } },
  });
  assert.equal(items[0].name, "Renamed");
  assert.equal(items[0].pinned, false, "an explicit false must survive `??`");
  assert.equal(items[0].archived, true);
});

test("the final sort is pinned-first, then openedAt desc, then path", () => {
  const items = buildProjectIndex({
    durableProjects: [],
    recents: [
      recent("/w/b", "b", 100),
      recent("/w/c", "c", 100),
      recent("/w/a", "a", 5, { pinned: true }),
      recent("/w/d", "d", 300),
    ],
    sessionProjects: [],
    projectMeta: {},
  });
  assert.deepEqual(
    items.map((item) => item.path),
    ["/w/a", "/w/d", "/w/b", "/w/c"],
  );
});

test("a session-derived project and the live workspace are indexed too", () => {
  const items = buildProjectIndex({
    durableProjects: [],
    recents: [],
    sessionProjects: [{ path: "/w/session", name: "session", updatedAt: 77 }],
    workspace: { path: "/w/live", name: "Live", branch: "main" },
    projectMeta: {},
  });
  const byPath = new Map(items.map((item) => [item.path, item]));
  assert.equal(byPath.get("/w/session")?.openedAt, 77);
  assert.equal(byPath.get("/w/live")?.name, "Live");
  assert.equal(byPath.get("/w/live")?.branch, "main");
});

test("an empty path is never indexed", () => {
  assert.deepEqual(
    buildProjectIndex({
      durableProjects: [],
      recents: [recent("   ", "blank", 1)],
      sessionProjects: [],
      projectMeta: {},
    }),
    [],
  );
});

/* ---------- projectRowId ---------- */

test("projectRowId percent-encodes, so separator variants keep distinct ids", () => {
  const withHyphen = projectRowId("/w/api-server");
  const withSlash = projectRowId("/w/api/server");
  assert.notEqual(withHyphen, withSlash, "a slug would have collided here");
  assert.ok(withHyphen.startsWith("projects-row-"));
  assert.equal(withHyphen, `projects-row-${encodeURIComponent("/w/api-server")}`);
  // A space cannot survive into an id unencoded.
  assert.doesNotMatch(projectRowId("/w/my app"), /\s/);
});

/* ---------- Tables the page renders from ---------- */

test("the section and status tables match the shipped catalogs", async () => {
  const [en, zh] = await Promise.all([
    readFile(new URL("../src/i18n/locales/en/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/locales/zh-CN/index.ts", import.meta.url), "utf8"),
  ]);
  // A key may ship as a bare entry or as an i18next plural pair, so both
  // spellings are accepted; the catalogs are i18next-dialect and stay that way.
  const declared = (source, key) => {
    const leaf = key.slice(key.indexOf(".") + 1);
    return new RegExp(`\\b${leaf}(?:_(?:one|other))?:`).test(source);
  };
  for (const key of [
    ...Object.values(GROUP_LABEL_KEYS),
    ...Object.values(PROJECT_STATUS_LABEL_KEYS),
    "project.selectProject",
    "project.sessionsCount",
    "project.updatedNever",
    "project.newTask",
    "project.noSessions",
    "project.showMoreSessions",
    "project.showFewerSessions",
    "project.foldersLabel",
    // The one key the catalog lacked and the inspector needs.
    "project.open",
  ]) {
    assert.ok(declared(en, key), `en catalog is missing ${key}`);
    assert.ok(declared(zh, key), `zh-CN catalog is missing ${key}`);
  }
  assert.deepEqual(GROUP_ORDER, ["pinned", "projects", "archived"]);
  assert.deepEqual(SORT_MODES, ["recent", "name"]);
  assert.equal(INITIAL_VISIBLE_SESSION_COUNT, 8);
});

/* ---------- The markup and stylesheet ---------- */

const [indexSource, panelSource, pageSource, styles] = await Promise.all([
  readFile(
    new URL("../src/renderer/features/projects/ProjectArchiveIndex.vue", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/renderer/features/projects/ProjectDetailPanel.vue", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/renderer/pages/ProjectsPage.vue", import.meta.url), "utf8"),
  loadStyles(),
]);

test("the index renders the carried-over classes and no per-row expander", () => {
  for (const name of [
    "projects-index",
    "projects-row-disclosure",
    "projects-inspector",
    "projects-row-block",
    "projects-row-meta",
  ]) {
    assert.match(indexSource, new RegExp(`"${name}`), `index is missing ${name}`);
  }
  // The per-row expand button and its detail pane are gone: the open card
  // is the row itself, and the detail renders inside `.projects-inspector`.
  //
  // Read the *template* block only. Both the page and the index name the deleted
  // classes in their own header comments, which record what was removed; what
  // must not survive is markup that renders them.
  const templateOf = (source) => source.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? "";
  for (const gone of ["projects-expand", "projects-row-detail", "projects-name-btn"]) {
    assert.doesNotMatch(templateOf(indexSource), new RegExp(gone), `index still renders ${gone}`);
    assert.doesNotMatch(templateOf(pageSource), new RegExp(gone), `page still renders ${gone}`);
  }
  // The detail is a slot, and the row is the button that owns the open state.
  assert.match(indexSource, /<slot name="detail" \/>/);
  assert.match(indexSource, /@click="emit\('select'/);
  assert.match(indexSource, /@dblclick="emit\('activate'/);
});

test("the detail panel renders the carried-over classes and its own slots", () => {
  for (const name of [
    "projects-detail-bar",
    "projects-detail-facts",
    "projects-detail-roots",
    "projects-detail-root",
    "projects-detail-task",
  ]) {
    assert.match(panelSource, new RegExp(`"${name}`), `panel is missing ${name}`);
  }
  assert.match(panelSource, /<slot name="actions" \/>/);
  assert.match(panelSource, /emit\('open-session'/);
  assert.match(panelSource, /emit\('rename-session'/);
  assert.match(panelSource, /emit\('show-more'/);
  assert.match(panelSource, /emit\('show-less'/);
  assert.match(panelSource, /emit\('new-task'/);
});

test("the page adopts the one-open-card model and the keyboard walk", () => {
  assert.match(pageSource, /class="projects-workbench" tabindex="0" @keydown="onIndexKeyDown"/);
  assert.match(pageSource, /nextArchiveOpenPath\(openPath\.value, path\)/);
  assert.match(pageSource, /neighborPath\(/);
  assert.match(pageSource, /projectRowId\(next\)/);
  assert.match(pageSource, /closest\("\.projects-inspector"\)/);
  // The per-row expanded record and its menu-free toggle are gone.
  assert.doesNotMatch(pageSource, /const expanded = ref/);
  assert.doesNotMatch(pageSource, /expanded\[project\.path\]/);
  // The single open path replaces them.
  assert.match(pageSource, /const openPath = ref<string \| null>\(null\)/);
});

test("every carried-over rule block exists in the stylesheet", () => {
  for (const selector of [
    ".projects-workbench {",
    ".projects-workbench:focus-visible {",
    ".projects-index {",
    ".projects-row-block.open {",
    ".projects-row:focus-visible {",
    ".projects-row-meta {",
    ".projects-row-disclosure {",
    ".projects-row-block.open .projects-row-disclosure {",
    ".projects-inspector {",
    "@keyframes projects-detail-in {",
    ".projects-detail-bar {",
    ".projects-detail-facts {",
    ".projects-detail-root.is-branch {",
    ".projects-detail-task:focus-visible {",
  ]) {
    assert.ok(styles.includes(selector), `stylesheet is missing ${selector}`);
  }
  // The `:lang(zh-*)` override and the two responsive blocks.
  assert.match(
    styles,
    /:lang\(zh-CN\) \.projects-group-label,\s*:lang\(zh-TW\) \.projects-group-label,\s*:lang\(zh-CN\) \.projects-detail-label,\s*:lang\(zh-TW\) \.projects-detail-label \{/,
  );
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.projects-row-meta \{\s*display: none;/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.projects-inspector \{\s*padding-left: 14px;/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.projects-inspector,\s*\.projects-menu\.is-open \{\s*animation: none;/,
  );
  // The selectors whose DOM was removed are deleted, not left behind.
  for (const dead of [
    ".projects-row-detail",
    ".projects-expand",
    ".projects-name-btn",
    ".projects-row-actions",
    ".projects-name-meta",
    ".projects-meta-dot",
    ".projects-tag.is-pin",
  ]) {
    assert.equal(styles.includes(dead), false, `stylesheet still carries ${dead}`);
  }
});
