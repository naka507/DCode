# DCode

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Release Line](https://img.shields.io/badge/Release_Line-1.0.x-green.svg)](package.json)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

[English](README.md) | [简体中文](README.zh-CN.md)

**DCode** 是一个面向自主与交互式 AI 编程智能体（AI Coding Agents）的开源桌面工作区。它融合了 Electron 跨平台外壳、基于 Vue 3 的现代化响应式界面、独立的 Node.js 智能体运行时，以及高性能原生特权宿主核心。

---

## 项目状态 (Status)

- **当前版本线 (Release Line):** `1.0.x` (当前稳定版本: `1.0.1`)
- **开源协议 (License):** Apache License 2.0 (Apache-2.0)

---

## 核心架构

DCode 采用清晰的分层多进程架构，具备严格的权责边界与安全性保障：

```
┌────────────────────────────────────────────────────────┐
│                   渲染进程 (Vue 3 界面)                │
│    三栏式现代化布局、基于 Pinia shallowRef 的状态容器    │
└───────────────────────────┬────────────────────────────┘
                            │ Preload IPC 桥接
┌───────────────────────────▼────────────────────────────┐
│                  Electron 主进程 (Main Process)         │
│         轻量调度中心、多窗口管理、生命周期与 IPC 路由    │
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
┌─────────────▼─────────────┐   ┌─────────▼──────────────┐
│        原生宿主核心       │   │  智能体运行时 (Sidecar) │
│ SQLite 数据持久化与底层工具 │   │ pi-ai / pi-agent-core  │
└───────────────────────────┘   └────────────────────────┘
```

- **渲染层 (`src/renderer/`)**：基于 Vue 3 与 Pinia（使用 `shallowRef` 避免 IPC 序列化性能损耗），内置 28 个分层样式模块，提供三栏响应式工作区、Shiki 代码高亮与 Mermaid 架构图解析渲染。
- **主进程 (`src/main/`)**：充当轻量级调度器，管理应用启动引导、窗口生命周期、插件运行时沙箱与安全 IPC 路由。
- **智能体运行时 (`src/agent/runtime/`)**：基于 Node.js Sidecar（由 esbuild 打包），封装 `pi-ai` 与 `pi-agent-core`，驱动多轮对话执行、流式输出分发及子智能体（Subagents）管理。
- **原生宿主核心**：独占负责 SQLite 数据库持久化（`pi.sqlite`），提供进程作业隔离（Job Objects）、高精度文件补丁（Hashline）、极速文件扫描与系统级原生工具调用。

---

## 主要特性

- 🤖 **多智能体协作与子任务编排 (Subagents)**：支持并行或串行分发子任务，子智能体执行过程与工具调用支持实时增量流式渲染，具备完整的任务监督与状态流转机制。
- 🛠️ **原生级开发工具箱**：内置终端命令执行环境（PowerShell / Bash）、基于精确哈希定位的代码编辑替换（Hashline Patch）、树形文件管理系统以及基于浏览器自动化的 `pi.browser`。
- 🧠 **全模型生态集成**：原生兼容 Anthropic Claude、OpenAI、DeepSeek、Ollama 及各类自定义 OpenAI 兼容接口，深度打通 `models.dev` 模型元数据目录并实现自动参数补全。
- 📝 **规划模式与审核面板 (Plan Mode & Review)**：支持智能体计划生成、分步执行审查、会话快照与时间线检查点（Checkpoints）一键回退。
- 🔌 **插件扩展体系 (Plugin SDK & DevKit)**：提供完善的插件 SDK 与脚手架命令行工具（`pi-plugin`），支持自定义 Webview 侧边面板、智能体工具扩展（Agent Tools）、命令注册与自定义技能包（Skills）。
- 🛡️ **安全托管与权限沙箱 (Safe Managed Mode)**：内置安全托管模式（`auto`）。大模型在当前项目配置的工作区目录、`.dcode` 记忆与配置目录、以及历史已授权路径内享有完全操作权限（自由创建、修改及删除），无需弹窗打扰；越界外部路径由特权宿主底层直接静默阻断（Fail-Fast），将拒信反馈给模型且绝不打断任务执行流。
- 🔍 **会话与交互记录追踪**：支持跨会话毫秒级全文检索、代码片段精准高亮与结构化日志追溯。
- 🎨 **现代化跨平台体验**：深色/浅色自适应主题、macOS 原生毛玻璃（Vibrancy）视觉效果，原生支持英文与简体中文双语界面。

---

## 目录结构

```text
DCode/
├── build/                 # 应用图标、安装包配置及打包资源
├── docs/                  # 详细架构白皮书与媒体资源
│   └── ARCHITECTURE.md    # 核心架构规范与设计决策记录
├── resources/             # 内置 Skills、预装插件与 models.dev 模型目录
├── scripts/               # 自动化构建、E2E 测试套件与质量检查脚本
│   └── README.md          # 内部工程脚本使用说明
├── src/
│   ├── agent/                 # 智能体核心模块
│   │   ├── host/              # Headless 智能体宿主（准入控制、任务队列、审批流）
│   │   └── runtime/           # pi sidecar 运行时（由 npm run build:sidecar 构建）
│   ├── engine/                # 系统执行引擎（进程管理、Turn生命周期监管、工作区比对）
│   ├── i18n/                  # 国际化语言包（en, zh-CN）
│   ├── main/                  # Electron 主进程与 IPC 通信端点
│   ├── plugin/                # 插件生态
│   │   ├── devkit/            # pi-plugin 开发者 CLI 工具
│   │   └── sdk/               # 插件规范定义、类型及校验逻辑
│   ├── preload/               # Electron Preload 预加载安全桥接脚本
│   ├── racp/              # RACP-WS 通信协议与设备配对
│   ├── renderer/          # 基于 Vue 3 的渲染层前端工程
│   └── shared/            # 跨进程共享协议、错误码与数据契约
└── tests/                 # Node 测试套件 (node --test) 与 Vitest 单元测试
```

---

## 快速上手

### 环境准备

- **Node.js**：`≥ 22.19.0`
- **npm**：包管理工具（基于 `package-lock.json`）
- **原生宿主核心程序**：放置于 `bin/` 目录下的 `DCore`（Windows 为 `DCore.exe`）可执行程序（在发行版安装包中已内置，或在本地开发环境提供）
- **Python 3**：（可选）用于重新生成应用图标等品牌素材

### 安装与构建步骤

1. 克隆 DCode 仓库：

```bash
git clone https://github.com/naka507/DCode.git
```

2. 安装前端与运行时依赖并应用补丁：

```bash
cd DCode
npm install
```

3. 构建智能体运行时 Sidecar：

```bash
npm run build:sidecar
```

4. 确保 `bin/` 目录下具备原生宿主二进制（或通过 `DCODE_HOST_BIN` 环境变量指定）：

```bash
# 查看 bin 目录
ls bin/
```

### 本地启动与调试

启动包含热更新（HMR）的 Electron 桌面客户端：

```bash
npm run dev
```

---

## 安全托管模式与权限隔离机制

DCode 提供了精细化的权限模式控制体系（`ask` 每次询问、`accept-edits` 自动接受工作区编辑、`auto` 安全托管）。在开启**安全托管模式（`auto`）**时，系统遵循以下安全边界原则：

### 1. 授权边界定义 (Authorized Scope)
大模型在安全托管模式下，合法操作范围严格限定于：
- **项目工作区文件目录**：当前项目配置的全部文件夹（支持多根目录 `ProjectGroupRoot` 集合）；
- **`.dcode` 记忆与配置目录**：包含项目内的 `.dcode/` 目录以及全局用户数据目录（`~/.dcode`）；
- **历史授权过的路径**：在会话中经由用户明确审批通过并登记在白名单（`authorized_paths`）中的外部目录或文件；
- **会话暂存区 (Scratch)**：供智能体临时存放脚本和中间产物的独立隔离目录。

### 2. 授权范围内的操作权限
在上述授权边界内部，大模型享有完全自主操作特权：
- 支持自由进行文件的读取、创建、覆盖更新以及**删除**（包括通过 Bash 执行 `rm`/`del` 等，进程当前工作目录 CWD 强锁定在工作区内）；
- 所有的合法操作均全自动静默执行，无需弹窗打扰用户。

### 3. 越界保护与静默拒绝 (Fail-Fast & Non-Interrupting)
- 一旦大模型试图调用或访问授权白名单以外的系统目录（如越界读取系统全局目录、探测未授权的其他项目等）：
  - **特权宿主底层直接硬拒绝**（返回 `PermissionDecision::Deny`）；
  - **绝不弹出权限审批卡片，绝不挂起或阻断任务**；
  - 拒绝原因作为标准的工具执行错误结果（Tool Error Result）正常反馈给智能体上下文；
  - 大模型感知到外部路径受阻后，自动转向在合法项目目录内部寻找替代方案，保障自动化任务流的连续性。

---

## 测试与质量门禁

在提交代码前，建议运行以下质量门禁命令：

```bash
# 运行主测试套件（基于 node --test）
npm test

# 运行 Vitest 单元测试
npm run test:unit

# 运行全部测试
npm run test:all

# TypeScript 与 Vue 类型检查
npm run typecheck

# 代码规范与 Token 检查
npm run lint

# 架构约束规则校验
node scripts/check-architecture.mjs

# 智能体工作流策略同步检查
node scripts/check-agent-policy-sync.mjs
```

---

## 打包与发布

为目标平台打包发布可执行文件：

```bash
# 生成未打包的本地执行目录 (Unpacked)
npm run pack

# 构建当前系统对应的安装包
npm run dist

# 针对特定平台的发布构建
npm run dist:win     # Windows (NSIS 安装程序与免安装绿色版)
npm run dist:mac     # macOS (DMG 镜像与 Zip，支持 Apple Silicon / Intel)
npm run dist:linux   # Linux (AppImage 与 ASAR)
```

---

## 开源协议

本项目采用 **Apache License 2.0** 开源许可协议。详情请参阅 [LICENSE](LICENSE) 文件。
