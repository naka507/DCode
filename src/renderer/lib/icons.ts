/**
 * Icon wrappers for the Vue renderer.
 *
 * Covers the full set: 95
 * Lucide-backed exports plus three hand-written components (stop, dot, VS Code).
 * Defaults (16px, 1.75 stroke) match the hand-drawn icon set the app shipped
 * before Lucide. The rendered box is multiplied by `--font-scale` so chrome
 * glyphs stay in proportion with the Appearance type scale (D343) — Lucide
 * writes fixed `width`/`height` attributes, so the scale has to be applied
 * through the style, not the props.
 */
import {
  defineComponent,
  h,
  type Component,
  type CSSProperties,
  type PropType,
} from "vue";
import {
  Activity,
  AppWindow,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  AtSign,
  Bell,
  BookOpen,
  Bot,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ClipboardPaste,
  Clock,
  CloudDownload,
  Code2,
  Database,
  Download,
  Copy,
  Dot,
  ExternalLink,
  Eye,
  EyeOff,
  FileDiff,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Globe2,
  GitFork,
  GitPullRequestArrow,
  Image,
  Info,
  Keyboard,
  KeyRound,
  Link,
  ListChecks,
  LogOut,
  Mic,
  Minus,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  Music,
  Palette,
  PanelLeft,
  PanelRight,
  PanelRightOpen,
  Maximize2,
  Minimize2,
  PawPrint,
  PencilLine,
  Pin,
  Play,
  Plug,
  Plus,
  Power,
  RefreshCcw,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Slash,
  Smile,
  Sparkles,
  Square,
  Star,
  Sun,
  Target,
  Terminal,
  TextSelect,
  Trash2,
  TriangleAlert,
  UserRound,
  Undo2,
  Video,
  Webhook,
  Workflow,
  Wrench,
  X,
} from "lucide-vue-next";

/**
 * `lucide-vue-next` does export a `LucideProps`, but its `size` is
 * `24 | number`, which rejects the CSS-length sizes these wrappers accept
 * (`Number | String`). A minimal local type keeps the string sizes and lets any
 * other SVG attribute through via the index signature.
 */
export type IconProps = {
  size?: number | string;
  style?: CSSProperties | string;
  [key: string]: unknown;
};

/** `calc(Npx * var(--font-scale))`, tolerating a CSS length or a bare number. */
export function scaledIconBox(size: number | string | undefined = 16): string {
  if (typeof size === "number" && Number.isFinite(size)) {
    return `calc(${size}px * var(--font-scale))`;
  }
  if (typeof size === "string" && size.trim()) {
    const value = size.trim();
    return /[a-z%]+$/i.test(value)
      ? `calc(${value} * var(--font-scale))`
      : `calc(${value}px * var(--font-scale))`;
  }
  return "calc(16px * var(--font-scale))";
}

/* Defaults (16px, 1.75 stroke) match the app's previous hand-drawn icon set. */
function icon(Lucide: Component) {
  return defineComponent({
    name: "Icon",
    inheritAttrs: false,
    props: {
      size: { type: [Number, String] as PropType<number | string>, default: 16 },
      style: {
        type: [String, Object, Array] as PropType<CSSProperties | string>,
        default: undefined,
      },
    },
    setup(props, { attrs }) {
      return () =>
        h(Lucide, {
          ...attrs,
          size: typeof props.size === "number" ? props.size : 16,
          strokeWidth: 1.75,
          style: {
            width: scaledIconBox(props.size),
            height: scaledIconBox(props.size),
            ...(typeof props.style === "object" ? props.style : {}),
          },
        });
    },
  });
}

export const IconPlus = icon(Plus);
export const IconPower = icon(Power);
export const IconPlay = icon(Play);
export const IconBookOpen = icon(BookOpen);
/** Paste-from-clipboard actions (MCP config import). */
export const IconClipboard = icon(ClipboardPaste);
export const IconArchive = icon(Archive);
export const IconArchiveRestore = icon(ArchiveRestore);
export const IconActivity = icon(Activity);
export const IconArrowUpDown = icon(ArrowUpDown);
export const IconArrowRight = icon(ArrowRight);
export const IconSearch = icon(Search);
export const IconRefresh = icon(RefreshCcw);
export const IconChat = icon(MessageSquare);
/** Session creation affordance. Keep it distinct from generic add actions. */
export const IconNewSession = icon(MessageSquarePlus);
export const IconFolder = icon(Folder);
export const IconFolderOpen = icon(FolderOpen);
export const IconNewProject = icon(FolderPlus);
export const IconGripVertical = icon(GripVertical);
export const IconFileText = icon(FileText);
export const IconGlobe = icon(Globe2);
export const IconBranch = icon(GitFork);
export const IconTerminal = icon(Terminal);
export const IconPencil = icon(PencilLine);
export const IconWrench = icon(Wrench);
export const IconPullRequest = icon(GitPullRequestArrow);
export const IconClock = icon(Clock);
export const IconAt = icon(AtSign);
export const IconSettings = icon(Settings);
export const IconHelp = icon(CircleHelp);
export const IconPanel = icon(PanelRight);
export const IconPanelOpen = icon(PanelRightOpen);
export const IconPanelMaximize = icon(Maximize2);
export const IconPanelRestore = icon(Minimize2);
export const IconDiff = icon(FileDiff);
export const IconSidebar = icon(PanelLeft);
export const IconArrowUp = icon(ArrowUp);
export const IconArrowDown = icon(ArrowDown);
export const IconCopy = icon(Copy);
/* Chat context menus: hand a message's rendered text to the platform selection. */
export const IconTextSelect = icon(TextSelect);
export const IconCode = icon(Code2);
export const IconDatabase = icon(Database);
export const IconCheck = icon(Check);
export const IconBell = icon(Bell);
export const IconBot = icon(Bot);
export const IconCheckCheck = icon(CheckCheck);
export const IconShield = icon(Shield);
export const IconChevronDown = icon(ChevronDown);
export const IconClose = icon(X);
/* Frameless window chrome (WindowControls): minimize / maximize / restore. */
export const IconMinus = icon(Minus);
export const IconSquare = icon(Square);
export const IconSliders = icon(SlidersHorizontal);
export const IconConfig = icon(RefreshCcw);
export const IconChevronLeft = icon(ChevronLeft);
export const IconChevronRight = icon(ChevronRight);
export const IconExternal = icon(ExternalLink);
export const IconArrowUpRight = icon(ArrowUpRight);
export const IconUndo2 = icon(Undo2);
export const IconCloudDown = icon(CloudDownload);
export const IconDownload = icon(Download);
export const IconImage = icon(Image);
export const IconCamera = icon(Camera);
/* Composer attachment chips: one glyph per file family. */
export const IconSheet = icon(FileSpreadsheet);
export const IconAudio = icon(Music);
export const IconVideo = icon(Video);
export const IconReview = icon(RefreshCw);
export const IconKeyboard = icon(Keyboard);
export const IconMic = icon(Mic);
export const IconPlug = icon(Plug);
export const IconSlash = icon(Slash);
export const IconUser = icon(UserRound);
/** A signed-in vendor account, as opposed to a pasted key. */
export const IconKey = icon(KeyRound);
export const IconLogOut = icon(LogOut);
export const IconSparkles = icon(Sparkles);
export const IconListChecks = icon(ListChecks);
/** Goal mode: an outcome to reach, as opposed to Plan's list of steps. */
export const IconTarget = icon(Target);
export const IconBrowser = icon(AppWindow);
export const IconHook = icon(Webhook);
export const IconWorkflow = icon(Workflow);
export const IconLink = icon(Link);
export const IconPalette = icon(Palette);
export const IconPerson = icon(Smile);
export const IconInfo = icon(Info);
export const IconServer = icon(Server);
export const IconSun = icon(Sun);
export const IconMoon = icon(Moon);
export const IconMonitor = icon(Monitor);
export const IconPet = icon(PawPrint);
export const IconSnapshot = icon(RotateCw);
export const IconGear = icon(Settings);
export const IconPin = icon(Pin);
export const IconMore = icon(MoreHorizontal);
export const IconX = icon(X);
export const IconTrash = icon(Trash2);
export const IconStar = icon(Star);
/* Toast status glyphs (see ToastHost) */
export const IconCircleCheck = icon(CircleCheck);
export const IconCircleAlert = icon(CircleAlert);
export const IconTriangleAlert = icon(TriangleAlert);
/* Password field reveal toggle (see PasswordInput). */
export const IconEye = icon(Eye);
export const IconEyeOff = icon(EyeOff);
/*
 * Stop glyph: Lucide's Square filled solid. lucide-vue-next coerces a 0
 * stroke width back to its 2px default, so the square's own outline shows
 * through the fill; harmless here because fill covers the same box.
 */
export const IconStop = defineComponent({
  name: "IconStop",
  inheritAttrs: false,
  props: {
    size: { type: [Number, String] as PropType<number | string>, default: 16 },
    style: {
      type: [String, Object, Array] as PropType<CSSProperties | string>,
      default: undefined,
    },
  },
  setup(props, { attrs }) {
    return () =>
      h(Square, {
        ...attrs,
        size: typeof props.size === "number" ? props.size : 16,
        strokeWidth: 0,
        fill: "currentColor",
        style: {
          width: scaledIconBox(props.size),
          height: scaledIconBox(props.size),
          ...(typeof props.style === "object" ? props.style : {}),
        },
      });
  },
});

/* Heavy round-capped stroke renders Lucide's Dot at the old filled-dot size. */
export const IconDot = defineComponent({
  name: "IconDot",
  inheritAttrs: false,
  props: {
    size: { type: [Number, String] as PropType<number | string>, default: 16 },
    style: {
      type: [String, Object, Array] as PropType<CSSProperties | string>,
      default: undefined,
    },
  },
  setup(props, { attrs }) {
    return () =>
      h(Dot, {
        ...attrs,
        size: typeof props.size === "number" ? props.size : 16,
        strokeWidth: 6.5,
        style: {
          width: scaledIconBox(props.size),
          height: scaledIconBox(props.size),
          ...(typeof props.style === "object" ? props.style : {}),
        },
      });
  },
});

/**
 * VS Code brand mark (settings open-target pill) — logos stay custom, no
 * Lucide equivalent.
 */
export const IconVSCode = defineComponent({
  name: "IconVSCode",
  inheritAttrs: false,
  props: {
    size: { type: Number, default: 14 },
  },
  setup(props, { attrs }) {
    return () => {
      const style = attrs.style as CSSProperties | string | undefined;
      return h(
        "svg",
        {
          width: props.size,
          height: props.size,
          viewBox: "0 0 24 24",
          fill: "none",
          xmlns: "http://www.w3.org/2000/svg",
          "aria-hidden": true,
          ...attrs,
          style: {
            width: scaledIconBox(props.size),
            height: scaledIconBox(props.size),
            ...(typeof style === "object" ? style : {}),
          },
        },
        [
          h("path", {
            d: "M17.5 2.6 21 4.2v15.6l-3.5 1.6-9.2-7.2L3 17V7l5.3-2.8 9.2 7.2V2.6Z",
            fill: "#0078D4",
          }),
          h("path", {
            d: "M17.5 2.6v11.4L8.3 7.2 17.5 2.6Z",
            fill: "#0090F1",
            opacity: "0.92",
          }),
          h("path", {
            d: "M8.3 16.8 17.5 21.4V10.6L8.3 16.8Z",
            fill: "#0065A9",
            opacity: "0.95",
          }),
        ],
      );
    };
  },
});
