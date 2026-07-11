# 项目架构

## 原则

- `index.html` 只提供页面骨架和资源入口。
- `main.js` 只组装功能、绑定事件并协调渲染。
- `domain/` 只放纯业务计算，不访问 DOM、网络或浏览器存储。
- `features/` 负责功能视图、Canvas 渲染和交互适配。
- `services/` 隔离网络、记录存储和撤销历史。
- `state/` 负责记录 schema 判断和后续的状态迁移。
- Python 与 PowerShell 必须保持相同的静态资源白名单与 API 行为。

## 目录职责

```text
app/
├── assets/styles/        样式令牌与按功能分拆的 CSS
├── config/               版本、端点、历史限制和默认策略
├── core/                 DOM 边界、号码通用工具和几何函数
├── domain/
│   ├── chart/           走势识别和表格模型
│   ├── prediction/      预测号码解析
│   ├── strategy/        策略评分引擎
│   └── backtest/        按期号回测与汇总
├── features/
│   ├── annotation/      标注模型和 Canvas 渲染
│   └── backtest/        回测视图
├── services/             记录仓储和撤销历史
├── state/                记录 schema
├── index.html            静态页面骨架
└── main.js               应用组装与事件协调
```

## 依赖方向

```text
index.html -> main.js -> features/services/state -> domain/core/config
```

下层模块不得反向导入上层模块。算法模块全部使用显式参数，不读取页面全局变量。

## 数据安全

- 记录 schema 版本保持为 10，旧记录继续可读。
- 回测只使用与开奖期号一致的当期历史预测。
- 服务端只公开 `app/` 中非隐藏的 HTML/JS/CSS 与三个明确的数据文件。
- 记录写入、备份和数据刷新均使用并发锁。
