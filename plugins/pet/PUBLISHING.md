# @yshark/dsh-codex-pet 打包与发布指南

## 1. 包信息

- npm 包名：`@yshark/dsh-codex-pet`
- 插件入口：`lib/index.mjs`
- 组合包 patch：`cordis.patch.yml`
- 运行依赖：`@yshark/pet-protocol`、`ws`
- 只发布桥接插件，不包含浏览器客户端 bundle 或宠物库代码。

## 2. 本地安装（开发/调试）

```sh
cd /path/to/dsh-pet-plugin/plugins/pet
npm test
```

安装到当前 DSH Web profile：

```sh
dsh plugin --profile web add link:/绝对路径/dsh-pet-plugin/plugins/pet
dsh web
```

## 3. 发布前检查

```sh
cd plugins/pet
npm test
npm pack --dry-run
```

`npm pack --dry-run` 应包含：

- `lib/index.mjs`
- `cordis.patch.yml`
- `package.json`
- `README.md`
- `PUBLISHING.md`

## 4. 发布到 npm

```sh
cd plugins/pet
npm login
npm publish
```

## 5. 更新版本

修改 `package.json` 中 `version`，然后重新发布：

```sh
npm version patch
npm publish
```

## 6. 注意事项

- 包名 `@yshark/dsh-codex-pet` 会作为插件 id。
- 桥接插件只做 DSH → 桌宠线协议翻译；宠物状态机、渲染和宠物库都在桌宠侧。
- 桌宠地址默认为 `ws://127.0.0.1:3720/v1`，可通过 `DSH_PET_URL` 覆盖。
