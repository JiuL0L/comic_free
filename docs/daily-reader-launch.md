# Windows 一键启动

双击仓库根目录的 `Start-Comic-Free.cmd`，它会从自身所在目录启动 Comic Free，并在两个本地服务均就绪后打开默认浏览器：`http://127.0.0.1:5173/`。

启动器不会下载或安装 Node.js、pnpm、Java 或 Suwayomi。Node.js 26.x 和 pnpm 10.x 是启动硬性要求。若已配置 Suwayomi Plugin Host，启动器会检查 Java 21、`javac`、`jar` 和配置的 JAR；检查失败只会显示提示，Comic Free 仍会打开设置页，供你修正路径或配置。Core 在启动 Plugin Host 前仍会验证 JAR 路径和已批准的 SHA-256，启动器不会执行未经验证的 JAR。未配置 Plugin Host 时仍可使用本地 fixture 阅读功能。

设置保存在 `COMIC_FREE_DATA_DIR/settings.json`；未指定环境变量时数据目录为仓库下的 `.local-data`。启动器只读取该文件，不迁移、删除或覆盖现有库和数据。环境变量可用于一次性运行时覆盖：

- `COMIC_FREE_DATA_DIR`
- `COMIC_FREE_SUWAYOMI_JAR`
- `COMIC_FREE_SUWAYOMI_APPROVED_SHA256`
- `COMIC_FREE_SUWAYOMI_PROXY`
- `COMIC_FREE_SUWAYOMI_PORT`

按 `Ctrl+C` 会请求 Local Core 先停止受管 Plugin Host，再关闭 WebUI；看到命令完成后再关闭窗口。若 3210 和 5173 端口已由一个可用的 Comic Free 实例占用，启动器会直接在浏览器中打开它；其他进程占用端口时会显示处理建议，且不会终止任何无关进程。启动失败时窗口会暂停，以便查看具体错误。
