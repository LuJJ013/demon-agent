项目约定

开发须知
1.每次改动前，先 commit 一个检查点。

文字与数学
中文表达专业、严谨、简洁，兼顾初学者。
行内数学用\(...\)，行间用$$....$$。不输出流水式日记。

代码风格
1.遵循 DeepSeek Hamess 的代码与注释风格，注释不复述代码。
2.不为低概率风险编写过度防御代码。
3.使用 ponytail，保持实现最小、清晰、可维护。
依赖与环境
Python 环境使用 uv sync.
使用 pnpm管理依赖，相关工具安装在local/下，优先使用本地工具。

测试反馈
测试放在tests/，命名为*.spec.ts，使用node:test;辅助脚本不使用该后缀。
显式运行指定文件，例如./.local/node/bin/node --import tsx 一testtests/cordis.spec.ts;不默认执行全量 pnpm test.