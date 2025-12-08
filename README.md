# BurnCloud AI Chat

一个基于 Next.js 构建的现代化 AI 聊天应用，支持多种 AI 模型和多模态交互。

## 功能特点

- 🤖 **多模型支持**：集成多种先进 AI 模型
- 📸 **多模态交互**：支持图片和视频上传，实现视觉内容理解
- 💬 **流畅对话体验**：实时流式响应，提供自然的聊天感受
- 🗂️ **会话管理**：支持创建、切换、重命名和删除会话
- ⌨️ **键盘快捷键**：便捷的操作方式，提升使用效率
- 🎨 **响应式设计**：适配桌面和移动设备
- ⚙️ **灵活配置**：支持自定义模型和 API 设置
- 📋 **提示词模板**：内置多种场景化提示词模板

## 技术栈

- **前端框架**：Next.js 16
- **React 版本**：React 19
- **样式方案**：Tailwind CSS
- **状态管理**：Zustand
- **UI 组件**：自定义 UI 组件库
- **构建工具**：TypeScript
- **代码规范**：Biome

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

应用将在 [http://localhost:3000](http://localhost:3000) 启动。

### 构建生产版本

```bash
pnpm build
pnpm start
```

## 使用指南

### 基础聊天

1. 在输入框中输入您的问题或消息
2. 点击发送按钮或按下回车键发送
3. 等待 AI 生成响应（支持流式显示）

### 上传媒体文件

1. 点击输入框左侧的上传按钮
2. 选择支持的图片或视频文件（最大 5MB）
3. 输入相关问题，发送即可

### 切换模型

1. 在侧边栏或设置中选择不同的 AI 模型
2. 支持的模型包括：GPT-4.1、GPT-4o、Claude 系列、DeepSeek 系列

### 会话管理

- **新建会话**：点击侧边栏顶部的「新建」按钮
- **切换会话**：点击侧边栏中的会话列表项
- **重命名会话**：右键点击会话，选择「重命名」
- **删除会话**：右键点击会话，选择「删除」

### 键盘快捷键

- `Cmd/Ctrl + K`：聚焦到输入框
- `Alt + ↑/↓`：切换会话
- `Esc`：关闭侧栏或抽屉

## 项目结构

```
.
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── api/          # API 路由
│   │   │   ├── chat/     # 聊天 API
│   │   │   └── upload/   # 文件上传 API
│   │   ├── layout.tsx    # 根布局
│   │   └── page.tsx      # 主页面
│   ├── components/       # React 组件
│   │   ├── ui/           # UI 组件库
│   │   └── message-bubble.tsx  # 消息气泡组件
│   └── lib/              # 工具库
│       ├── store/        # 状态管理
│       ├── types.ts      # TypeScript 类型定义
│       └── utils.ts      # 工具函数
├── burncloud/            # 飞牛NAS 支持
├── public/               # 静态资源
└── package.json          # 项目依赖
```

## 配置说明

### 环境变量

目前项目主要通过前端配置管理 AI 服务提供商信息，支持在设置中配置：

- API 密钥
- 基础 URL
- 默认模型
- 支持的模型列表

### 支持的 AI 提供商

- **BurnCloud**：默认提供商，支持多种主流 AI 模型

## 开发说明

### 代码规范

项目使用 Biome 进行代码检查和格式化：

```bash
# 检查代码
pnpm lint

# 自动格式化代码
pnpm format
```

### 类型检查

```bash
pnpm typecheck
```

## 部署

### Vercel 部署

1. 登录 Vercel 账号
2. 导入项目仓库
3. 配置环境变量（如果需要）
4. 点击部署按钮

### 其他部署方式

支持部署到任何支持 Next.js 的平台，如：

- Netlify
- AWS Amplify
- Docker

### 飞牛NAS支持

该应用已集成飞牛NAS支持，可直接在飞牛NAS设备上部署和运行。

#### 飞牛NAS部署特点

- **一键安装**：通过飞牛NAS应用商店一键安装
- **本地运行**：应用完全在飞牛NAS本地运行，数据隐私更有保障
- **资源共享**：可与飞牛NAS的文件系统集成，方便访问本地文件
- **系统集成**：与飞牛NAS的用户权限系统深度集成

#### 飞牛NAS配置文件

项目包含完整的飞牛NAS集成配置：

```
burncloud/
├── manifest              # 应用基本信息
├── config/
│   ├── resource         # 数据共享配置
│   └── privilege        # 用户权限配置
└── cmd/                 # 命令行工具
```

#### 飞牛NAS应用信息

- **应用名称**：BurnCloud Chat
- **版本**：0.0.1
- **维护者**：iXaydaYun
- **依赖**：Node.js v22

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

如有问题或建议，欢迎通过以下方式联系：

- 项目仓库：[GitHub](https://github.com/iXaydaYun/BurnCloud-Chat)
- BurnCloud官方网站：[https://www.burncloud.com](https://www.burncloud.com)
