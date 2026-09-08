// dsh-web-enhance — host half（纯插件实现，零文件补丁）
//
// 为 dsh Web GUI 补齐「当前会话 → 归档」能力。与已装社区的
// dsh-session-unarchive（恢复方向）对称：
//   - 归档走 workspace registry：优先调用内置 archiveSession(sessionId)
//     （rc.6+ 版本存在）；缺失时回退 enqueueOperation/requireState/setState
//     向 archivedSessionIds 追加，与内置实现同构。setState 持久化写盘后，
//     workspace 变更流自动广播 host/archived-sessions-changed，内置 UI 与
//     client store 自动同步，归档的会话从所有视图消失。
//   - 提供一个 HTTP 端点（webServer.register，同源 /api/ 前缀）：
//       POST /api/web-enhance/archive { sessionId } → 归档一个会话
//   - dsh 升级不会覆盖本插件。若上游重构 registry 内部方法，端点返回 500
//     并给出明确提示，不会破坏 dsh。

const PATH_ARCHIVE = '/api/web-enhance/archive';

const MAX_BODY_BYTES = 16 * 1024;

/** Collect a JSON request body with a hard size cap. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

export const name = 'web-enhance';

// 硬依赖：等待 webServer（HTTP 路由）与 workspaceRegistry（归档状态）注册
// 后再 apply，避免启动早期 ctx.get 返回 undefined。
export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  const registry = ctx.get('workspaceRegistry');
  if (webServer === undefined || registry === undefined) {
    console.warn('[dsh-web-enhance] webServer/workspaceRegistry unavailable — host half disabled');
    return;
  }

  const hasArchiveSession = typeof registry.archiveSession === 'function';
  const registryCapable =
    typeof registry.enqueueOperation === 'function' &&
    typeof registry.requireState === 'function' &&
    typeof registry.setState === 'function';

  // 归档一个会话：追加进 registry-global 归档集合（已在集合中则幂等返回）。
  // 与内置 archiveSession / 社区 restore 共用写串行队列与持久化路径；成功后
  // apiproxy 的 workspace 变更流广播 host/archived-sessions-changed，UI 自动隐藏。
  async function archiveOne(sessionId) {
    if (hasArchiveSession) {
      await registry.archiveSession(sessionId);
      return;
    }
    if (!registryCapable) {
      throw new Error(
        'workspace registry no longer exposes archiveSession or enqueueOperation/requireState/setState ' +
        '(dsh 升级改变了内部结构?) — 请升级本插件或反馈上游'
      );
    }
    await registry.enqueueOperation(async () => {
      const state = registry.requireState();
      if (state.archivedSessionIds.includes(sessionId)) return;
      await registry.setState({
        ...state,
        archivedSessionIds: [...state.archivedSessionIds, sessionId]
      });
    });
  }

  // 路由注册用 ctx.effect 包裹，返回的 disposer 在插件 stop/update/undefine 时
  // 自动移除路由（避免停用后端点仍生效、或重复注册 duplicate route 报错）。
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PATH_ARCHIVE,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'method not allowed (use POST)' });
          return;
        }
        const body = await readJsonBody(req);
        const sessionId = body?.sessionId;
        if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) {
          writeJson(res, 400, { ok: false, error: 'sessionId must be a non-empty string' });
          return;
        }
        await archiveOne(sessionId);
        writeJson(res, 200, { ok: true, archivedSessionIds: [...registry.archivedSessionIds] });
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));

  console.log(`[dsh-web-enhance] host ready: ${PATH_ARCHIVE} ${hasArchiveSession ? '(archiveSession OK)' : (registryCapable ? '(registry fallback OK)' : '(registry API MISSING)')}`);
}
