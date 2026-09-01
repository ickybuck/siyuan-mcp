/**
 * 写后读回的统一做法。
 *
 * 两条规则，都是踩出来的：
 *
 * 1. 不要拿 SQL 索引给写操作做见证。索引落后块写入 1–2 秒，有时更久（PF-49）。
 *    rename_document 曾经因此在每一次首次改名时抛错、引用旧标题，而改名其实已经成功；
 *    batch_replace_tag 则漏数了刚打上标签、还没进索引的块，然后用同一个滞后的源头
 *    报了一句 remaining: 0。写完立刻失败，比原来的静默成功更危险：调用方会去重试或
 *    回滚一件已经做完的事。
 *
 * 2. 读不出结论 ≠ 写失败。轮询之后仍然读不到新值，只说明看不见，不说明没写进去。
 *    这时返回 verified: false，把判断权交回调用方；只有读回来的值明确和写入的值
 *    相矛盾（既不是新值，也不是原来那个待覆盖的旧值），才算真的证伪，才抛错。
 */

export interface ReadBackOutcome<T> {
  /** 读回来的值确实等于写入的值 */
  verified: boolean;
  /** 最后一次读到的值 */
  observed?: T;
  /** 一共读了几次 */
  attempts: number;
}

export interface ReadBackOptions {
  /** 最多读几次，默认 8 */
  attempts?: number;
  /** 第一次读之前等多久，默认 150ms */
  firstDelayMs?: number;
  /** 之后每次读之前等多久，默认 300ms */
  delayMs?: number;
}

/**
 * 反复读同一个值，直到它满足条件或者次数用完。
 *
 * 读取本身抛错（块还没落盘、接口暂时 404）不算失败，继续下一次；确实读不到就以
 * verified: false 收场，由调用方决定怎么说这件事。
 */
export async function readBackUntil<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  options: ReadBackOptions = {}
): Promise<ReadBackOutcome<T>> {
  const attempts = options.attempts ?? 8;
  const firstDelayMs = options.firstDelayMs ?? 150;
  const delayMs = options.delayMs ?? 300;

  let observed: T | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? firstDelayMs : delayMs));
    try {
      observed = await read();
      if (matches(observed)) {
        return { verified: true, observed, attempts: attempt + 1 };
      }
    } catch {
      // 读不到就再读一次；读取失败不是写入失败的证据
    }
  }

  return { verified: false, observed, attempts };
}

/**
 * 写操作确认不了时该说的话。
 *
 * 措辞是刻意的：说"没能确认"，不说"失败了"。前者会让人再去看一眼，后者会让人重试
 * 或者回滚，而那两件事对一个其实已经成功的写入都是有害的。
 */
export function unverifiedNote(what: string, observed?: string): string {
  return (
    `The write to ${what} was accepted, but reading it back did not show the new value within about two seconds. ` +
    `This is most often the read lagging rather than the write failing — the SQL index trails block writes, so a fresh ` +
    `value can be invisible for a while after it is stored.${observed ? ` Last read back: ${JSON.stringify(observed)}.` : ''} ` +
    `Nothing was rolled back and nothing needs re-sending; read it again in a moment to confirm.`
  );
}
