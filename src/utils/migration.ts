/**
 * 数据迁移注册表
 * - 用于 schema 版本升级时对历史数据做转换
 * - 当前版本无迁移需求，预留扩展位
 */

export interface Migration {
  from: number;
  to: number;
  migrate: (data: unknown) => unknown;
}

/** 已注册的迁移规则（按 from -> to 顺序应用，当前为空） */
export const migrations: Migration[] = [];

/**
 * 按 from -> to 顺序应用迁移；无匹配迁移则原样返回
 */
export function migrateData(
  data: unknown,
  fromV: number,
  toV: number,
): unknown {
  if (fromV === toV) return data;
  let current = data;
  let currentV = fromV;
  while (currentV < toV) {
    const m = migrations.find((item) => item.from === currentV);
    if (!m) {
      // 无匹配迁移，停止并原样返回当前数据
      break;
    }
    current = m.migrate(current);
    currentV = m.to;
  }
  return current;
}
