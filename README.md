# reactTree

`react-jsx-tree` is a terminal tool that prints a **clean JSX tree** (no props) starting from a React / React Native entry file, and **recursively expands** locally-imported components **only inside the starting folder**.

## Install

```bash
npm install
npm run build
```

### (Optional) Install as a command

From this repo folder:

```bash
npm link
```

Then you can run `react-jsx-tree ...` instead of `node dist/cli.js ...`.

## Usage

```bash
# one-shot
node dist/cli.js path/to/index.tsx

# watch mode (live-updating output)
node dist/cli.js path/to/index.tsx --watch

# ignore folders under the start file's folder (comma-separated)
node dist/cli.js path/to/index.tsx --watch --ignore ui,components/ui

# show which file each expanded component came from
node dist/cli.js path/to/index.tsx --show-expanded-from

# interactive TUI (collapsed-by-default; arrow keys + Enter to expand/collapse)
node dist/cli.js path/to/index.tsx --interactive

# interactive + watch (live updates; watches only files involved in the tree)
node dist/cli.js path/to/index.tsx --interactive --watch

# interactive + mouse (click to toggle)
node dist/cli.js path/to/index.tsx --interactive --mouse
```

## Interactive controls

- **Up/Down**: move selection
- **Enter / Space / +**: expand/collapse selected node
- **q** or **Ctrl+C**: quit
- **Mouse (optional)**: click to toggle (enable with `--mouse`)

## Rules

- Only follows **relative imports** (`./` / `../`) that resolve to `.tsx/.ts/.jsx/.js`
- Will **not** expand any import that resolves **outside** the starting file’s folder (tree only goes downward)
- `--ignore` folders are relative to the starting file’s folder
- Watch mode is **focused**: it watches only the start file + any component files that are currently part of the expanded tree (prevents `EMFILE` on large projects)

## Interactive rendering behavior

- The interactive view renders **DOM-style JSX** with **4-space indentation**
- Only components that expand from a **separate file** are toggleable, and are marked with `=>`
- All toggleable components start **collapsed by default**
- Expanding a parent does **not** auto-expand nested toggleable components
