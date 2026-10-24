# 独立验证报告：dsh-workspace-archive

验证对象：`<workspace>/dsh-workspace-archive`（`@local/dsh-workspace-archive` 0.1.0；§7 覆盖 0.2.0 的置顶功能）
宿主基线：DSH `0.1.7-rc.1`，profile `web`，Node `v26.3.1`（§7 的活体基线为桌面版 `0.2.0-rc.2`，Web profile `desktop`）
报告时间：2026-09-24（§7 追加于 2026-10-05）

---

## 0. 验证归属与独立性声明（先读这一节）

**本报告由 Team Lead 撰写，不是由独立验证者撰写的。**

原计划由独立 teammate `verifier` 承担 task-3（静态对抗审查 + 活体验证）。该 teammate 在长时间运行后**未产出任何文件**（`VERIFICATION.md` 始终不存在），经 lead 发出的范围收窄指令仍无产出，最终被 `interrupt_agent` 中断，随后 task-3 由 lead 接管（revision 3，owner=lead）。

因此：

- 下文所有「亲自执行并观察到」的证据，执行者是 **Lead 本人**——也就是这份代码的作者。
- 这带来**利益冲突**：作者审自己的代码，系统性遗漏的可能性显著高于独立第三方。
- 可被独立复现的部分（命令输出、槽位 occupant 列表、纯函数单测）不受此影响：任何人重跑命令都应当得到同样结果。真正受影响的是**「该发现的缺陷是否都发现了」这一判断**。
- 补偿措施：几何/契约层面的判断尽量不靠推理，而是对照宿主**自己的实现**逐条比对（下文每条都给了宿主对照位置）；此外仍保留一轮**用户验收**作为最终关口（见第 5 节）。

---

## 1. 结论摘要

| 类别 | 条目 |
|---|---|
| **通过（Lead 亲自执行并观察到）** | 语法与清单自检 15/15；纯函数单测 23/23；`dsh --profile web --dump-config` 含本插件行；四个插槽的登记项在运行实例中均 `active: true`；宿主既有 occupant 无一处被替换或遮蔽；插件显示元数据（title/description/icon）可经 exports 映射解析 |
| **通过（对照宿主实现核对，非推理）** | 只用 `require('react')`；归档只经 `ctx.uiWorkspace.archiveSession/unarchiveSession`；`workspace/session-active` 判定与宿主逐字一致；选择器取值形状与宿主自己的用法逐字一致；`use<NewName>` 命名规则经宿主函数体确认 |
| **不通过** | 无 |
| **无法验证（本会话能力之外）** | 视觉呈现（浅/深色主题一致性、按钮态、弹层实际观感）；点击后的真实归档结果；`shell.overlay` 的父级 `pointer-events` 在真实页面中的最终效果；菜单项与宿主菜单键盘漫游的实际联动 |
| **开发期真实缺陷（已修，见第 4 节）** | 5 处：页面 return 结构错乱；遮罩点击分派错误；`<style>` 非法嵌进 `<button>`；进度层遮挡造成文案与实现矛盾；`node --test test/` 在 Node 26 必然失败 |

---

## 2. 阶段 A：静态对抗审查

### A1. 契约一致性

| 项 | 结论 | 证据 |
|---|---|---|
| 只用 `require('react')` | 通过 | `client.js:32` `const React = require('react');`；全文件 require 目标集合经 `scripts/check.mjs` 正向提取 = `['react']`；`require('@deepseek-ai/` 与 `from '@deepseek-ai/` 均 0 命中 |
| 不触碰 `document.body` | 通过 | 0 命中（开发期注释里曾出现该字面量，已改写措辞） |
| 不替换应用根 | 通过 | 无 `createRoot`/`render` 调用；只注册插槽 |
| 不读其它插件 DOM | 通过 | 无 `querySelector`/`closest`/`MutationObserver`；唯一的 DOM 级 API 是 `window.addEventListener('keydown')`（用于 Escape）与组件局部 `<style>` |

### A2. 四个插槽的注册正确性（对照运行实例的权威契约）

| 插槽 | 注册字段 | 结论 |
|---|---|---|
| `sidebar.panellist` | `{ name, id: PANEL_ID, order: 20, label: panelLabel, locale: NS }`（`client.js:1316`） | 通过。列表 id 与 `main` 的 key 同为 `'workspace-archive'`；`label` 为 thunk，符合「thunk 每次投影重读」的契约；组件接收 `size`，`active` 由侧边栏自己负责选中态（与宿主 `PluginsPanelIcon` 一致） |
| `main` | `{ name: 'main', key: PANEL_ID, locale: NS, inject }`（`client.js:1328`） | 通过。用**新** key，未复用 `conversation`/`plugins` |
| `sidebar.workspaces.session.menu.item` | `{ name, id: MENU_ID, order: 450, locale: NS, inject }`（`client.js:1344`） | 通过。id 带包名前缀；order 450 排在宿主 `archive`(400) 之后，语义合理（更粗粒度在后） |
| `shell.overlay` | `{ name, id: OVERLAY_ID, order: 100, locale: NS, inject }`（`client.js:1360`） | 通过。新 id；与 `mcp-connector`(100) 同序不冲突（list 允许同序，注册序决定先后） |

要点核对：

- **菜单项必须渲染一个 `role="menuitem"` 的 button，且动作后关闭菜单**：`client.js:1056-1066` 渲染 `<button type="button" role="menuitem">`，`onClick` 首句 `setOpen(false)`（`client.js:1064`）再执行动作。**通过**。
- **菜单项在「不属于任何工作区」时不渲染可点控件**：`client.js:1052` `if (owner === undefined || pendingCount === 0) return null;`。**通过**；且该 early return 之前已调用全部 hooks（`useMenuOpenState`、2×`useWorkspaces`、`useSessions`、2×`useMemo`），不存在 hooks 数量漂移。**通过**。
- **`useMenuOpenState` 由声明方注入**：本插件只是接收（`client.js:1038`），未在自己的 inject face 里声明它；对照宿主 `dsh-client-ui-workspace/lib/client.js:4028-4031` 在子插槽声明里提供 `inject: { hooks: { menuOpenState: menuOpenStateFactory } }`。**通过**。
- **菜单项除 button 外多渲染了一个 `<style>` 元素**（`client.js:1058`）。这是**有意的偏离**：契约说「渲染一个 button」，DOM 结果是 button + 一个 `display:none` 的 `<style>`。理由见 A3；风险评估：宿主 `Menu` 的 viewport 只是 `[items.map(renderEntry), children]`（`dsh-client-ui-primitives/lib/index.js:3845` 附近），不做 `Children.map` 包装，`<style>` 在 UA 样式表下 `display:none`，不参与 flex 布局，也不匹配 `button[role="menuitem"]` 的键盘漫游。**判定为可接受，但属未在真实浏览器中验证的一项。**

### A3. 状态与渲染正确性

**选择器引用稳定性**——我逐一比对了宿主自己的用法，而不是凭推理：

| 本插件写法 | 宿主自己的等价写法 | 结论 |
|---|---|---|
| `useWorkspaces((state) => state.items)` | `dsh-client-ui-workspace/lib/client.js` 中存在同形 `useWorkspaces((state) => state.items)` | 通过 |
| `useWorkspaces((state) => state.phase)` | 同上，存在 `state.phase` | 通过 |
| `useWorkspaces((state) => state.archivedSessionIds)` | 同上，存在该写法 | 通过 |
| `useWorkspaces((state) => state)`（overlay） | 同上，存在 `(state) => state` | 通过 |
| `useSessions((state) => state.byId)` | 宿主多处 `useSessions((state) => state.byId)` | 通过 |

关键点：**没有任何选择器返回新建的数组/对象/Set**。`new Set(archivedIds)` 一律在 `useMemo`/`useCallback` 内构造，不在选择器里。因此不需要 `eq` 参数。派生计数全部在 `useMemo` 内（`client.js` 的 `groups` / `totals` / `pendingCount`）。

**hooks 调用顺序**：`WorkspaceArchivePage` 与 `ArchiveWorkspaceMenuItem` 的所有 hooks 都在任何 early return 之前；`WorkspaceArchiveOverlay` 的前 3 个 `useEffect` 在 `if (!active) return null;` 之前调用，符合 hooks 规则。**通过**。

**`useWaState` 的命名**：由 `hooks: { waState: store }` 派生。命名规则经宿主函数体确认：`dsh-client-ui-slots/lib/index.js` 的 `standardHookPropName(name)` = `` `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}` `` → `useWaState`。**通过**。
**自建 store 的形状**：`getSnapshot()` + `subscribe()`（`client.js` 的 `createStore`），满足 `HostObservable<T> = ObservableSnapshot<T>`（`dsh-client-store/lib/types/contract.d.ts:3-12`）。**通过**。

### A4. 归档语义正确性

| 检查项 | 结论 | 证据 |
|---|---|---|
| 只经 `ctx.uiWorkspace` 触发归档 | 通过 | `archiveSession(id, stopRunning ? {stopActivity:true} : undefined)` 与 `unarchiveSession(id)`，全文件仅此两条写路径 |
| `workspace/session-active` 判定与宿主一致 | 通过 | `client.js:235` `if (!(error instanceof Error) \|\| error.name !== 'WorkspaceArchiveError') return false;` 再判 `rpcError.code === 'workspace/session-active'`；与宿主 `dsh-client-ui-workspace/lib/client.js:4123-4127` 的 `activeSessionRefusal` 逐字同构 |
| 失败不被吞 | 通过 | 非 refusal 的异常进入 `run.failed.push({ id, message: messageOf(error) })`，并在结果面板逐条列出 `id — message` |
| 单飞守卫 | 通过 | `startRun` 首句 `if (store.getSnapshot().run !== null) return;`（`client.js:378`）；`requestArchive`/`requestUnarchive` 亦各自守卫 |
| 取消只影响未处理项 | 通过 | 循环顶部 `if (cancelRequested) { run.cancelled = true; break; }`；已完成项此前已写入 `archivedIds`/`skippedRunning`/`failed`，进入结果面板 |
| 连点安全 | 通过 | 归档/恢复在 Host 侧是集合语义（幂等）；已归档会话在重新计算 targets 时被排除 |

### A5. 生命周期

- `locale.register` 与**四处**（非三处）`slots.inject` 全部包在 `ctx.effect` 内（`client.js:1283`、`1312`、`1323`、`1339`、`1356`），插件 unload 时一并释放。**通过**。
- locale 注册有 try/catch 兜底，注册失败只告警不阻断 UI；`panelLabel` 与 `translator()` 均有降级。**通过**。
- **批量执行器在插件作用域**（`ctx.effect` 之外的 `createRunner(ctx)`，由 `apply` 持有），不在任何组件内 → 面板被切换或被归档清空主视图都不会中断运行。这是「执行器独立于组件」的真正实现点。**通过**。
- `connection/reset` 监听在 `ctx.effect` 内（`client.js:531-536`），触发时把 `cancelRequested` 置真 → 当前会话处理完后停下，已处理部分写入结果并标记 `cancelled`。**通过**。

### A6. 空白会话与 subagent 规则

- `client.js:197` `if (summary !== undefined && summary.origin === 'subagent') continue;` —— 子代理会话不进任何桶，也不进 `members`。对照宿主 `dsh-client-ui-workspace/lib/client.js:397` 的 `if (session.origin === "subagent") return false;`（列表可见性）以及宿主自己的 `useSessions((state) => state.byId[sessionId]?.origin === "subagent")` 用法。**通过**。
- `client.js:199` 空白会话单独成桶，因此既不计入「待归档」，也不会被工作区批量归档；展开列表里仍可见、可单独归档。**通过**。

---

## 3. 阶段 B：安装后活体验证（Lead 亲自执行）

### B1. profile 组合

```
$ dsh --profile web --dump-config
1404:# == @local/dsh-workspace-archive
1405:- id: workspace-archive
1406:  name: '@local/dsh-workspace-archive'
```

注：该命令需要写 profile 目录下的 `cordis.yml`，在 `workspace-write` 沙箱下首次运行以 `EPERM: operation not permitted, open '<profile>/cordis.yml'` 失败；经一次性提权后重跑成功。**如实记录：失败的那次是沙箱限制，不是插件问题。**

另有进度：`plugin_manager install_bundle`（target = 包目录绝对路径）返回
`{"stage":"enable","target":"@local/dsh-workspace-archive","enabled":true,"changed":true,"application":"applied","packageResult":{"exitCode":0,...}}`，
pnpm 以 **link** 方式安装（`+ @local/dsh-workspace-archive link:<workspace>/dsh-workspace-archive`），即工作区源码目录就是被装载的包。

### B2. 四个插槽的 occupant（`cordis_inspect_query` / platform=client / provider=Slots / method=listSubTree）

| 插槽 | occupants（id/key, order, active） |
|---|---|
| `sidebar.panellist` | `plugins`(0, true)、**`workspace-archive`(20, true)** |
| `main` | `plugins`(true)、`conversation`(true)、**`workspace-archive`(true)** |
| `sidebar.workspaces.session.menu.item` | `pin`(100)、`rename`(200)、`fork`(300)、`archive`(400)、**`workspace-archive.archive-workspace`(450)**，全部 `active: true` |
| `shell.overlay` | `dsh-market-toast`、`workspace.session-rename`、`workspace.session-archive`、`workspace.row-toast`、`context-overview`(10)、`mcp-connector`(100)、**`workspace-archive.dialog`(100)**，全部 `active: true` |

**回归结论：宿主既有的 11 个 occupant 一个都没有被替换或遮蔽。** 这也证明客户端模块已 materialize 且 `apply()` 未抛异常（否则登记项不会 `active`）。

### B3. 插件显示元数据

经 profile 的 `exports` 映射实际解析（`node -e` + `createRequire`）：

```
OK   @local/dsh-workspace-archive/locale/en.json -> .../dsh-workspace-archive/locale/en.json
OK   @local/dsh-workspace-archive/locale/zh.json -> .../dsh-workspace-archive/locale/zh.json
OK   @local/dsh-workspace-archive/package.json  -> .../dsh-workspace-archive/package.json
OK   @local/dsh-workspace-archive/client        -> .../dsh-workspace-archive/client.js
OK   @local/dsh-workspace-archive               -> .../dsh-workspace-archive/index.js
icon field: ./icon.svg | zh title: 工作区归档
```

### B4. shell.overlay 的 pointer-events 契约（一处需要点明的风险）

宿主 `dsh-client-ui-layout/lib/client.js`（AppFrame 样式字符串）为：

```css
.overlayLayer{ z-index:20; pointer-events:none; position:absolute; inset:0 }
.overlayLayer>*{ pointer-events:auto }
```

即：容器 click-through，**直接子元素**自动 opt-in。本插件 overlay 的根是 `h('div', { className: 'dsh-wa-layer' }, ...)`，是该容器的直接子元素，因此可获得 `pointer-events:auto`。

- 代码层面：结构正确（已核对）。
- **运行层面：无法验证**——本会话没有浏览器控制与截图能力，无法确认点击是否真的落到弹层上。列为待用户确认项。

同时说明本插件**主动避免**了长时间遮挡：进度层使用 `.dsh-wa-layerPassive{pointer-events:none}` + `.dsh-wa-layerPassive>*{pointer-events:auto}`（`client.js:623-624`）并不渲染遮罩，因此批量执行期间应用仍可操作——这正是「执行器独立于面板」这一设计得以兑现的前提。

---

## 4. 开发期发现的真实缺陷（均已修复）

| # | 缺陷 | 复现路径 | 修复 |
|---|---|---|---|
| 1 | 页面 `return` 结构错乱：children 数组被拼接后又丢弃，实际渲染内容不完整 | 打开面板即可见内容缺失 | 重写 `WorkspaceArchivePage` 的 return，显式构造 head/status/groups/run 四段 |
| 2 | 遮罩点击一律调用 `dismissResult`，导致**确认框点遮罩关不掉**（`pending` 未被清除） | 打开确认框 → 点遮罩 | 按层分派：`pending → cancelPending`，`result → dismissResult` |
| 3 | `<style>` 直接嵌在 `<button role="menuitem">` 内部，属非法内容模型 | 打开会话「...」菜单 | 改用 `Fragment` 包裹 `<style>` + `<button>`，两者成为菜单 viewport 的兄弟节点 |
| 4 | **文案与实现矛盾**：进度层带全屏遮罩 + 拦截点击，但文案承诺「可以切换到别的面板」；这会直接废掉「执行器独立于面板」的设计价值 | 批量归档执行中尝试切换面板 | 进度层改为右下角浮动卡片：passive 层、不渲染遮罩、仅卡片接收点击；焦点也不再被抢占（`role="status"` + `aria-live`，且跳过自动聚焦） |
| 5 | `package.json` 的 `"test": "node --test test/"` 在 Node 26 必然失败（裸目录参数不再展开，报 `Cannot find module .../test`） | `npm test` | 改为 `node --test "test/**/*.test.mjs"`；已实测 23/23 |

缺陷 5 由 teammate `harness-dev` 发现并提出两个候选修法，Lead 选定其一并亲自改的 `package.json`（`package.json` 属 Lead 写入范围）。

---

## 4.1 交付后由用户报告的真实缺陷：点归档按钮无反应（已定位并修复）

**用户报告**：「实际上这个归档插件还是有问题，目前点击归档按钮无反应。」——插件已安装、图标与面板都可见，但点击任何归档按钮都没有任何可见反应。

### 根因

`client.js` 的模块级 `inject` 只声明了 `['slots', 'locale', 'uiWorkspace']`，而代码在**点击时**读取 `ctx.workspaces` 与 `ctx.sessions`（`liveState()`、`scopeOfWorkspace()`、`scopeOfUngrouped()`、`requestArchiveForSession()`）。

Cordis 的上下文代理对 `ctx.<服务名>` 的属性读取按 fiber 的 `inject` 声明做校验，未声明且不在上下文链上的服务会直接抛错。在真实拓扑里：

- `workspaces` 由 `WorkspaceController extends cordis Service` 注册在**提供者插件自己的 fiber** 上（`dsh-api-workspace-controller/lib/client.js:452`），因此对本插件而言是**兄弟 fiber**，未声明读取必然抛错；
- `sessions` 由 `dsh-api-session-controller/lib/client.js:3192` 通过 `rootCtx.reflect.provide("sessions", this, void 0)` 注册在 **root** 上。

`ctx.workspaces` 是 `liveState()` 的第一句，所以**每一个**动作入口都在第一行抛错。异常发生在 React `onClick` 处理器内部，被错误边界吞掉：界面不报错、不弹层、什么都不发生——正是用户描述的「无反应」。面板本身能正常渲染，是因为页面用的是 renderer 提供的标准 hook（`useWorkspaces`/`useSessions`），从未直接读 `ctx`，所以「界面看起来正常但所有按钮都死」这个组合症状完全自洽。

### 证据链

1. **权威契约**：Client `Service` Inspect 对 `workspaces` / `sessions` 都给出
   `hardDependency: { inject: ['workspaces'], expression: 'ctx.workspaces' }` 与
   `optional: { expression: 'ctx.get("workspaces")', requiresUndefinedCheck: true }`
   ——即属性读取属于「硬依赖」形态，必须声明在 `inject`。
2. **同源先例**：所有读取这两个服务的已发布客户端插件都声明了它们——`dsh-client-ui-workspace`（`inject` 含 `"sessions"`、`"workspaces"`）、`dsh-client-ui-schedule`、`dsh-client-ui-session`、`dsh-client-ui-reference`、`dsh-client-ui-open-in-app`。
3. **Cordis 源码**：`cordis/lib/index.js:676` 构造 `new Error('cannot get property "${prop}" without inject')`，`687` 行按 `prop in fiber.inject` 处理该错误。
4. **可复现实验（Node，导入真实 cordis）**：同一 root 下，提供者按 DSH 的方式注册后，消费者
   - 未声明时读 `ctx.workspaces` → `{"ok":false,"message":"cannot get property \"workspaces\" without inject"}`
   - 声明后读 `ctx.workspaces` → `{"ok":true,...,"archived":["x"]}`
5. **修复前/后的差异被测试固化**：把 `inject` 回退为旧值的副本上，`npm run check` 失败 2 项、`npm test` 失败 5 项（全部是新加的回归用例）；修好后 17/17 与 27/27 全绿。

### 修复内容

| # | 修复 | 说明 |
|---|---|---|
| A | `inject` 增加 `'workspaces'`、`'sessions'` | 主修复。两者本就是本插件所有计数、目标与按钮可用状态的唯一来源，属硬依赖而非 `ctx.get()` 可选查找 |
| B | 在 `createRunner` 开头**一次性**解析两个服务 | 点击路径不再触碰 `ctx`，从结构上消除「点击时才发现服务不可达」这类失败 |
| C | 新增**提示浮层（notice）** | `pending/run/result` 之外的第 4 层。两类情况都会显示：范围内已无可归档/可恢复项；动作意外失败（带错误原文，同时 `console.error` 全量错误） |
| D | `face()` 中所有动作经 `guarded()` 包装 | 任何同步异常都转成可见提示，而不是「看起来死掉的按钮」 |
| E | 区间按钮在无事可做时置灰禁用并给出 `title` 说明 | 之前按钮只是变淡，用户无法得知原因 |
| F | `scripts/check.mjs` 增加两条静态检查 | ① `client.js` 中每个 `ctx.<服务名>` 读取都必须在 `inject` 中声明；② `workspaces`/`sessions` 必须在列。这条检查在回退修复的副本上会失败，是本缺陷的永久回归守卫 |
| G | `package.json` 的 `dsh.client.inject` 增加两个服务提供者模块 | `@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-api-workspace-controller`，与已发布插件的声明方式一致 |

### 该缺陷暴露的工程教训（已写入 README）

> 「点击无反应」在客户端插件里是一个**结构性风险**：动作从 React 事件处理器发起，任何同步异常都会被错误边界吞掉，既不留痕也不可见。因此本插件现在坚持两条不变式：所有服务依赖必须显式声明在 `inject`；所有状态变更入口必须经过会把异常变成可见提示的执行器。

### 本节的独立性说明

根因定位、实验设计、修复与回归用例均由 Lead 完成（Lead 是本文件的作者，也是修复代码的作者）。随后由**独立子代理**在只读冻结产物、仅允许修改 `/tmp` 副本的前提下做了对抗性复核，结果记录在 §4.2。

---

## 5. 未验证项与建议的用户验收步骤

**本会话无法验证（缺浏览器控制/截图能力），必须由用户确认：**

1. 侧边栏在「插件」图标之后出现新图标；点击后中央面板打开「工作区归档」（语言为中文时标题应为「工作区归档」）。
2. 面板在**浅色与深色**两种主题下的观感；按钮悬停/焦点态；工作区分组的展开/折叠。
3. 面板中每个工作区行的计数 `共 N · 待归档 P · 已归档 A` 与侧边栏实际条目一致。
4. 点「归档全部」→ 确认框出现并能用 Escape / 点遮罩 / 「取消」三种方式关掉；勾选「同时停止运行中的会话」后确认，运行中的会话确实被停止并归档。
5. 批量执行期间**确实可以切换面板、继续操作应用**，右下角进度卡片可点「取消剩余」。
6. 执行完成后侧边栏对应会话变灰、不能直接打开；计数更新。
7. 结果面板的「恢复本次归档的 N 个」能把这一批还原；「停止并归档这 N 个」能补档被跳过的会话。
8. 会话行「...」菜单里出现「归档本工作区全部会话（P）」，点击后弹确认；当 `P=0` 或该会话不属于任何工作区时该条目不出现。
9. 若上述任一项显示的是**旧行为**（例如进度仍是全屏遮罩），请先刷新页面（Cmd/Ctrl+R）以加载最新客户端代际；仍不对则重启 `dsh web`。
10. **特别确认**：面板中「归档全部」按钮现在应当真的弹出确认框。若某个工作区已全部归档，该按钮会是置灰禁用状态，鼠标悬停会说明「这个范围里没有可归档的会话」——这属于预期的正常行为，不再是缺陷。

**建议的最小验收顺序**：先做 1 → 3 → 4（用一个小工作区），确认无误后再做 5 → 7。

---

## 6. 附录：可独立复现的命令与结果

```text
$ cd dsh-workspace-archive && npm run check
PASS  dsh-workspace-archive self-check — 17/17 checks passed        (exit 0)

$ npm test
ℹ tests 29   ℹ pass 29   ℹ fail 0                                    (exit 0)

$ for f in index.js client.js scripts/check.mjs test/plan.test.mjs; do node --check "$f"; done
OK ×4                                                                (exit 0)

$ node --version
v26.3.1
```

### §4.1 修复的反向验证（Lead 亲自执行，在 /tmp 副本上）

把 `inject` 回退为 `['slots','locale','uiWorkspace']` 的副本：

```text
FAIL  client.js: every `ctx.<service>` read is declared in `inject` — ctx.workspaces, ctx.sessions read but not declared
FAIL  client.js: `workspaces` and `sessions` are hard dependencies
FAIL  dsh-workspace-archive self-check — 2 of 17 checks failed

ℹ tests 29   ℹ pass 22   ℹ fail 7
✖ client module: registers the package id, injects its services, exposes apply
✖ apply: an enforcing root lets a workspace batch reach the confirmation layer
✖ apply: confirming a batch archives every pending session through uiWorkspace
✖ apply: the row entry archives its whole workspace
✖ apply: a batch with nothing left to archive reports a notice, never silence
✖ apply: an unexpected failure surfaces a notice instead of a dead button
✖ page: clicking "archive all" opens the confirmation, then archives every session
```

也就是说：**把主修复撤掉，会立刻红 2 项静态检查 + 7 个用例**，其中最后一条正是从真实组件树里点下「归档全部」、再点确认的完整操作路径。

### 组件级端到端证据（Lead 亲自执行）

用桩 React 渲染真实的 `WorkspaceArchivePage` 与 `WorkspaceArchiveOverlay`，在会强制执行 `inject` 校验的假 ctx 上，从渲染出的按钮一路点到 Host 调用：

```text
rendered buttons:
  - page.expandAll
  - <icon>
  - group.archiveAll
  - group.restoreAll [disabled]

clicking 归档全部 → pending layer: ["s1","s2"]
overlay confirm button: dialog.confirmArchive({"count":"2"})
calls: [["archive","s1",null],["archive","s2",null]]
result layer: ["s1","s2"] | run: null
```

这条链路不经过任何「直接调用 action」的捷径：按钮的 `onClick` 来自真实组件渲染结果。`restoreAll [disabled]` 也顺带证明「无可恢复项时按钮置灰」的行为符合预期。

### 活体一致性（Lead 亲自执行）

profile 的 `node_modules/@local/dsh-workspace-archive` 是指向本工作区目录的软链接，两端 `client.js` 的 sha256 前 16 位一致（profile 侧实际服务的就是修好的字节）：

```text
profile-served: 592b27ec77767db2
workspace     : 592b27ec77767db2
identical     : true
$ grep -n "const inject = \[" $PROFILE/node_modules/@local/dsh-workspace-archive/client.js
1423:    const inject = ['slots', 'locale', 'uiWorkspace', 'workspaces', 'sessions'];
```

`scripts/check.mjs` 的失败分支经 teammate `harness-dev` 反向验证过（在 /tmp 副本上）：删 `client.js` → 6/15 FAIL；注入 `require('@deepseek-ai/…')` + 语法错 → `node --check` 与 forbidden import 双 FAIL；坏 locale / 坏 yml `name` / 注入 `document.body` → 3/15 FAIL，均 exit 1。**该反向验证由 teammate 执行，Lead 未亲自重跑**（检查总数当时为 15，现为 17）。

---

## 7. 工作区置顶（0.2.0）的验证

本节只覆盖 0.2.0 新增的置顶功能，0.1.0 的归档部分仍以上文为准。归属：**由实现者（Lead）亲自执行**，因此与 §0 一样，它不是独立验证。

### 7.1 事实基线（先确认接口存在，再动手）

置顶没有现成能力，必须自己拼。开工前先确认宿主到底给了什么：

| 结论 | 证据 |
| --- | --- |
| 工作区**没有**原生置顶；原生只有会话置顶 | `dsh-api-workspace-controller@0.2.0-rc.2/lib/client.js:161-183` 的 `pinSession` / `unpinSession` 操作的是 `pinnedSessionIds`（会话 id），与工作区顺序无关 |
| 但工作区**可以**被持久化重排 | `dsh-client-ui-workspace/lib/client.js:4276` 的侧边栏拖拽实现就是 `workspaces.insertBefore(workspaceId, beforeWorkspaceId)`；`dsh-workspace/lib/index.js:477` 是它的 Host 实现（先摘除、再插到锚点前，无锚点则追加） |
| 置顶必须「保持」，因为新工作区会被前插 | `dsh-workspace/lib/index.js:685`：创建时 `workspaceIds: [id, ...state.workspaceIds]` |
| 侧边栏**没有**工作区行菜单可挂 | `cordis_inspect_query`（client / Slots / `listSubTree`，root=`sidebar.workspaces`）：该插槽 `kind: "single"` 且已被 ui-workspace 占位；可扩展的子插槽只有会话级的 `sidebar.workspaces.session.menu.item`、`sidebar.workspaces.session.row.action` 等 |
| 置顶集合只能记在客户端 | 宿主没有工作区置顶位；DSH 自己的客户端 store 也是用 localStorage 按 name 持久化（`dsh-client-store/lib/index.js:104-123`），本插件沿用同一机制 |
| 固定端口使 localStorage 跨启动有效 | `dsh-desktop-host/lib/index.js:231-235`：桌面版以 `--port 19387` 启动，origin 稳定 |

### 7.2 静态检查（`node scripts/check.mjs`）

```text
PASS  client.js: pins persist under the namespaced key `dsh.workspace-archive.pinned-workspaces` — 2 guarded access(es), 2 guard(s)
PASS  client.js: pin writes go through the declared `workspaces` service, feature-detected — insertBefore probed and used through the declared service
PASS  client.js: the pin menu row carries its own package-namespaced slot id — workspace-archive.archive-workspace, workspace-archive.pin-workspace

PASS  dsh-workspace-archive self-check — 20/20 checks passed
```

### 7.3 单元与行为测试（`node --test "test/**/*.test.mjs"`）

```text
ℹ tests 52   ℹ pass 52   ℹ fail 0
```

其中 22 条是置顶新增的：纯函数（`prunePins` / `desiredLead` / `leadSatisfied` / `planPinMoves` / `readPins` / `writePins`）与真实点击路径（面板置顶按钮、会话菜单置顶行、新工作区前插后的自动回位、取消置顶落点、删除工作区后的剪枝、加载期不误删、被拒重排只报一次不重试、无 localStorage 降级、无重排接口的版本隐藏控件）。

### 7.4 开发期被测试抓住的两个真实缺陷（均已修复）

这两条不是「补测试」，而是测试先红了才发现的行为错误：

1. **协调器会在置顶提交之前抢跑。** Host 在 `insertBefore` 返回的瞬间就发布了新顺序，而用户动作此时还没提交置顶集合；协调器读到旧集合，于是把刚移上去的行又移回去。
   修复：单写者锁 `withOrderLock`（写顺序期间协调器整体让位，写完后由写入者重新调度一次）。
   反向验证：在 /tmp 副本上删掉该锁 → **3 条用例红**（`newest pin leads the block`、`workspace created at the head`、`unpinning drops the row below`）。
2. **两次快速点击会互相覆盖。** 面板上先点 A 再点 B，两个动作都从「提交前」的集合计算，第二个会覆盖第一个。
   修复：`pinQueue` 串行化，且集合在任务真正执行时才重新读取。
   反向验证：删掉串行化 → **2 条用例红**（`workspace created at the head`、`unpinning drops the row below`）。

### 7.5 静态不变式的反向验证（Lead 亲自执行，/tmp 副本）

```text
1) 去掉 localStorage 守卫
   FAIL  client.js: pins persist under the namespaced key … — 2 member access(es) against 0 guard(s)
   （node --check 仍然通过：这是静默的运行时风险，正是这条检查存在的理由）

2) 去掉特性探测 + 让两条菜单行共用同一个 id
   FAIL  client.js: pin writes go through the declared `workspaces` service, feature-detected
   FAIL  client.js: the pin menu row carries its own package-namespaced slot id
   （同时 4 条用例红：identity constants / menu rows never collide / build without the reorder verb / menu pin row）
```

### 7.6 尚未验证的部分（需要用户点一下）

实现者无法在浏览器里点击，因此以下活体步骤**尚未执行**，请在刷新页面后自行验收（客户端 bundle 按内容校验和路由，刷新即取新字节）：

1. Cmd/Ctrl+R 刷新后打开「工作区归档」面板：每个工作区分组行应出现「置顶」按钮。
2. 点某个工作区的「置顶」：它应立即排到侧边栏最前，分组行出现「已置顶」，会话「...」菜单里变成「取消置顶本工作区」。
3. 新建一个工作区（它会出现在最前）：被置顶的工作区应在片刻后自动回到第一位。
4. 再刷新一次：置顶状态与顺序都应保留（localStorage + Host 顺序）。
5. 点「取消置顶」：该工作区应落到剩余置顶块之后的第一个位置。
6. 把某个置顶工作区拖到别处：应被拉回最前（这是「置顶」的定义；想让它留在别处请先取消置顶）。

若第 2 步没有任何反应，请打开浏览器控制台查看是否有 `[workspace-archive]` 前缀的日志，并把提示浮层的原文一并反馈。


## 8. 0.2.1 归档工作区仍显示侧栏的修复（2026-10-24）

本节覆盖前文关于「归档后工作区仍留在侧栏」的旧预期。本次由 Lead 实现并测试，另一个只读子代理核对了宿主数据流与兼容风险；不构成独立浏览器验收。

根因：DSH 0.2.1-rc.3 的默认分组对每个注册工作区生成标题，Session archive 仅修改 archivedSessionIds。即使归档 blank，也不会移除标题。插件旧版只批量归档 Session，从未实现 Workspace 的可见性。

修复：从完整归档集合推导已全部归档的实际工作区；对原生侧栏组件的工作区和会话快照一起过滤，避免进入未分组、平铺和搜索；管理面板保持完整数据并标示「已从侧栏隐藏」。空白占位不阻止隐藏，缺失摘要/未就绪基线不误隐藏，部分归档继续显示。恢复任一实际会话即重新显示。保留 retainAccountKeys 的完整工作区键，防止清除展开和手工排序。

兼容风险：宿主没有官方过滤器/wrapper。本次使用隔离的可卸载 entry.component 适配，保留原有 children/store/inject/locale，不复制声明子插槽。它依赖可修改的登记项结构，未来宿主升级需复测。纯快照过滤不删除注册、归属、文件或日志。

验证：语法/清单检查20/20；行为回归测试62/62。新增测试覆盖隐藏与恢复、空白/子代理、部分归档、加载期、未分组与搜索泄漏、缓存保留、卸载恢复、Host登记项替换、插槽优先级。

当前运行结果：通过 plugin_manager set_bundle 重新启用，返回 application=applied、warnings=[]。Client Slots 检查 sidebar.workspaces 原生 priority=0 occupant 为 active:true，插件通知项 priority=9007199254740991 为 active:false，原有五个子插槽仍在；sidebar.panellist 中 workspace-archive active:true。此次活体检查抓住并修复了优先级方向错误，避免空通知项遮住原生侧栏。该检查证明新代码执行和槽位加载，不能替代真实归档后的视觉检查。

安装障碍与恢复：install_bundle 原地更新返回 already-installed；按管理器要求 remove_bundle 后，包管理器被既有 dshmarket@1.70.1 的 minimumReleaseAge 策略拦截，返回 application=failed。移除操作已撤去 bundle选择，但链接依赖仍在；使用 set_bundle enabled:true 恢复并加载本地0.2.1，未修改锁文件或放宽安全策略。归档数据及置顶存储没有改写。

浏览器限制：ego-browser 打开当前 http://127.0.0.1:60652 只得到 authentication required；已关闭该测试空间，没有绕过认证。因此真实用户数据上的归档/恢复点击与视觉结果尚未实测。已有归档应由过滤逻辑自动隐藏，无须再次批量归档。推荐用户检查此前已归档的工作区是否消失，再从管理面板恢复一个会话确认重新显示。
