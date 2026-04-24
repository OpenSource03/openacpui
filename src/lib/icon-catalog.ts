/**
 * Shared catalog of curated emoji + lucide icons for project / space pickers.
 * Used by `IconPicker` (project icons) and `SpaceCustomizer` (space icons).
 *
 * Grouping is by visual category — categories flow naturally in the grid so
 * browsing feels like walking through related options. The full lucide library
 * (~1500 icons) remains available through the search input in each picker.
 */

// ── Emoji — ~200 curated, grouped by vibe ──

export const CURATED_EMOJIS: readonly string[] = [
  // Stars & sparkles (most popular — lead with these)
  "⭐", "🌟", "✨", "💫", "🌠", "⚡", "🔥", "💥",
  "☄️", "🌙", "🪐", "🌞", "🌈", "🎇", "🎆", "💡",

  // Faces & characters
  "😀", "😎", "🤓", "🧑‍💻", "👾", "🤖", "👻", "💀",
  "😈", "🥸", "🤩", "😇", "🫡", "🥳", "🤠", "👽",
  "🧙", "🧚", "🦸", "🦹", "🧛", "🧞", "🧜", "🧝",

  // Hearts & symbols
  "❤️", "💜", "💙", "💚", "💛", "🧡", "🩷", "🖤",
  "🩵", "🤍", "💝", "💖", "♾️", "☯️", "🔮", "🧿",
  "☮️", "☸️", "♠️", "♣️", "♥️", "♦️", "🈯", "🆎",

  // Nature & weather
  "🌊", "🍀", "🌸", "🌺", "🌻", "🌿", "🍂", "🍁",
  "🌷", "🌹", "🌼", "🪷", "🪴", "🌳", "🌲", "🌴",
  "🌵", "🍄", "🌾", "🌱", "☀️", "🌤️", "⛈️", "❄️",
  "🌪️", "🔆", "🌕", "🌗", "🌑", "💧", "🌡️", "🌫️",

  // Animals
  "🐱", "🐶", "🦊", "🐻", "🐼", "🦁", "🐸", "🦋",
  "🐝", "🦄", "🐙", "🐬", "🦅", "🐺", "🦎", "🐢",
  "🦜", "🦉", "🦇", "🐍", "🦖", "🐉", "🦈", "🐳",
  "🐧", "🐨", "🐯", "🦌", "🐿️", "🦦", "🦥", "🐔",

  // Food & drink
  "☕", "🧉", "🫖", "🍵", "🍷", "🍾", "🍺", "🧋",
  "🍕", "🍔", "🌮", "🌯", "🥐", "🥨", "🥞", "🧇",
  "🍜", "🍣", "🍱", "🍙", "🍪", "🍩", "🍰", "🧁",
  "🍎", "🍓", "🍑", "🍒", "🫐", "🥑", "🌽", "🌶️",

  // Objects & tools
  "🚀", "💎", "🎯", "🎨", "🎵", "📦", "🔔", "🛡️",
  "🏆", "🎮", "🎲", "📌", "🔑", "⚙️", "🔧", "🪛",
  "📐", "🧪", "💻", "🖥️", "📱", "🔬", "🧲", "📡",
  "🧭", "⏳", "📎", "🧮", "📖", "📚", "📝", "🧾",
  "🖋️", "🖌️", "🖍️", "🗝️", "🪪", "💼", "🎒", "🧰",

  // Activities & sports
  "🎭", "🎬", "🎪", "🎸", "🎤", "🎧", "🎺", "🥁",
  "🎻", "🪕", "🕹️", "♟️", "🎳", "🎾", "🏀", "⚽",
  "🏈", "🎣", "🥋", "🏄", "🚴", "🧗", "⛷️", "🤿",

  // Travel & places
  "🏠", "🏡", "🏢", "🏰", "⛩️", "🗽", "🗼", "🏔️",
  "🌍", "🌎", "🌏", "🗺️", "🏝️", "🌋", "🏜️", "🏗️",
  "✈️", "🚗", "🏍️", "🚲", "🛵", "🚂", "🛳️", "⛵",

  // Misc — tech / fun / abstract
  "🌀", "🧬", "🔒", "🔓", "🏴‍☠️", "🚩", "🏁", "🎌",
  "🛸", "🧊", "🫧", "🪩", "🎀", "🪬", "🌂", "🏮",
  "🎎", "🧶", "🧵", "🪄", "🔭", "⚗️", "🧫", "🪤",
];

// ── Lucide icon names — ~220 curated, grouped by vibe ──
// Names must match PascalCase keys in `import { icons } from "lucide-react"`.
// If a future lucide upgrade drops a name, the consumer guards against it
// (renders nothing), so the catalog stays forward-safe.

export const CURATED_LUCIDE_ICONS: readonly string[] = [
  // Popular / iconic
  "Sparkles", "Star", "Heart", "Zap", "Flame", "Rocket", "Crown", "Gem",
  "Trophy", "Medal", "Award", "Target", "Wand", "WandSparkles", "Shield", "BadgeCheck",

  // Tech & dev
  "Code", "CodeXml", "SquareCode", "Terminal", "SquareTerminal", "Cpu", "Database", "Server",
  "HardDrive", "Cloud", "CloudUpload", "CloudDownload", "Bug", "BugOff", "Boxes", "Component",
  "Braces", "Brackets", "Parentheses", "Binary", "MemoryStick", "Microchip", "CircuitBoard", "Router",
  "Laptop", "Monitor", "Smartphone", "Tablet", "Keyboard", "Mouse", "Usb", "Webhook",
  "Workflow", "Waypoints", "ServerCog", "Unplug", "Container", "FileCode", "FileCog", "FileTerminal",
  "FileKey", "FileLock", "FileCheck", "FileDiff", "FolderCog", "FolderKey", "FolderLock", "FolderSearch",
  "FolderSymlink", "PackageCheck", "PackageX", "Split", "Merge", "Import", "Recycle", "SquareDashedBottomCode",

  // Code syntax / symbols
  "Hash", "AtSign", "Asterisk", "SquareAsterisk", "SquareSlash", "Ampersand", "Percent", "SquareFunction",
  "Pilcrow", "Pi", "Sigma", "Divide", "Equal", "Dot",

  // AI & automation
  "BrainCircuit", "BrainCog",

  // Network & signal
  "Network", "Wifi", "WifiOff", "Antenna", "Satellite", "SatelliteDish", "RadioTower", "Cast", "Rss",

  // Security
  "LockKeyhole", "KeySquare", "ShieldEllipsis", "EyeOff", "BadgeAlert", "BadgeInfo",

  // Layout grids
  "LayoutGrid", "Grid2x2", "Grid3x3", "Columns3", "Rows3",

  // Git & build
  "GitBranch", "GitCommitHorizontal", "GitCompare", "GitFork", "GitMerge", "GitPullRequest", "Github",

  // Creativity
  "PenTool", "Pencil", "Pen", "Brush", "Paintbrush", "PaintRoller", "Palette", "Feather",
  "Highlighter", "Eraser", "Scissors", "Stamp", "Ruler", "Compass",

  // Containers & organization
  "Layers", "Layers2", "Box", "Package", "Package2", "PackageOpen", "Archive", "ArchiveRestore",
  "Inbox", "FolderOpen", "Folder", "FolderClosed", "FolderGit2", "FolderHeart", "FolderKanban", "FolderTree",
  "Files", "File", "FileText", "BookOpen", "Book", "BookMarked", "Library",
  "Album", "ClipboardList", "Clipboard", "NotebookPen", "Notebook", "StickyNote", "Tag", "Tags",

  // Nature
  "Leaf", "Trees", "TreePine", "TreeDeciduous", "Flower", "Flower2", "Sprout", "Shell",
  "Mountain", "MountainSnow", "Waves", "Droplet", "Droplets", "Snowflake", "Rainbow", "Sun",
  "Moon", "SunMoon", "CloudSun", "CloudMoon", "CloudRain", "CloudSnow", "CloudLightning", "Wind",
  "Tornado", "Sunrise", "Sunset", "Umbrella",

  // Shapes & abstract
  "Circle", "Square", "Triangle", "Hexagon", "Octagon", "Diamond", "Shapes", "Spade",

  // Objects & things
  "Coffee", "Pizza", "IceCreamCone", "Cake", "Cookie", "Candy", "Utensils", "ChefHat",
  "Lamp", "Lightbulb", "Flashlight", "Plug", "Power", "Battery", "Thermometer", "Gauge",

  // Travel & vehicles
  "Plane", "PlaneTakeoff", "Ship", "Anchor", "Sailboat", "Car", "CarFront", "Bike",
  "Bus", "TrainFront", "TrainTrack", "Truck", "Fuel", "Map", "MapPin", "Globe",
  "Earth", "Navigation", "Route", "TrafficCone", "Tent", "Bed",

  // Places & buildings
  "House", "Building", "Building2", "Store", "Factory", "Castle", "Church", "Hotel",
  "Hospital", "School", "Warehouse", "Landmark", "TentTree",

  // People & identity
  "User", "Users", "CircleUser", "UserCog", "Ghost", "Skull", "Brain", "Eye",
  "Smile", "Bot", "BotMessageSquare", "PersonStanding", "Baby", "Glasses", "ScanFace",

  // Music & media
  "Music", "Music2", "Music3", "Music4", "Mic", "MicVocal", "Guitar", "Piano",
  "Drum", "Drumstick", "Headphones", "Radio", "Theater", "Film", "Clapperboard", "Popcorn",
  "Play", "Pause", "Volume2",

  // Games & play
  "Gamepad2", "Dices", "Dice1", "Dice2", "Dice3", "Dice4", "Dice5", "Dice6",
  "Puzzle", "Joystick", "Swords", "Sword",

  // Weather & time
  "Clock", "Timer", "Hourglass", "Calendar", "CalendarDays", "CalendarHeart",

  // Emotion & abstract
  "Infinity", "Aperture", "Atom", "Orbit", "Telescope", "Microscope", "FlaskConical", "TestTube",
  "TestTubeDiagonal", "Dna",

  // Creativity & magic
  "Bolt", "Activity",

  // Work & business
  "Briefcase", "BriefcaseBusiness", "Luggage", "IdCard", "KeyRound", "Key", "Lock",
  "ShieldCheck", "ShieldAlert", "Bookmark", "Flag", "FlagTriangleRight", "Bell", "BellRing", "Megaphone",
  "LockOpen",

  // Animals (lucide has a modest set)
  "Bird", "Cat", "Dog", "Fish", "Rabbit", "Squirrel", "Turtle", "Worm",
  "Rat", "PawPrint", "Beef", "Origami",

  // Misc fun
  "Cherry", "Banana", "Apple", "Carrot", "Croissant", "Egg", "Salad", "Soup",
];
