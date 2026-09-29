/**
 * 时间敏感的测试夹具助手。
 * 绝对日期会在真实时间越过后静默改写被测代码走的分支（例如 deadline 过期 →
 * 提交按钮 disabled → 点击无效，用例失败或断言到非预期状态），
 * 因此凡是被产品代码消费的截止/有效期都应由「相对当前时刻」生成。
 */
import dayjs from 'dayjs';

const FORMAT = 'YYYY-MM-DD HH:mm:ss';

/** 距现在 n 天之后（用于「仍在有效期内」的截止/过期时间） */
export function inDays(n: number): string {
  return dayjs().add(n, 'day').format(FORMAT);
}

/** 距现在 n 天之前（用于「已过期」的截止/过期时间） */
export function agoDays(n: number): string {
  return dayjs().subtract(n, 'day').format(FORMAT);
}
