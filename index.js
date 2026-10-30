/**
 * 持续学习总纲 · dsh-learn-core（Host 插件，零依赖、无构建）
 *
 * 管"AI 谈自己学习与迭代时的口径"：学习口径检、合法答法两道纯本地闸。
 * 核心命题（四层辨析，正本=宪法《持续学习与自我迭代总纲令》）：
 *   1. 能力固化 —— 一次掌握，永不遗忘、永不退步：固化账永久留痕+验收命令定期
 *      验活+验活失败强制回炉。"学会但会忘/会退步"不是常态，是缺陷，缺陷要报。
 *   2. 在线学习 —— 数据到达即更新，不等批处理。判负线：只进会话层（对话记忆）
 *      不触发权重更新超过一个批次周期 = 学习降级运转。
 *   3. 无辅助迭代 —— 自己写自己/自己训练自己。长大了就不该还要人扶：
 *      主人的辅助=教学不是拐杖，教学会毕业，拐杖要扔。
 *   4. 迭代读数 —— 自我迭代必须挂验收尺（计分曲线单调不降），禁裸宣称
 *      "我在持续进步"却拿不出读数。
 *
 * 全部判定在插件内实现（零外部脚本依赖），规则可配，任何工作区装上即用。
 *
 * @module dsh-learn-core
 */

export const name = 'dsh-learn-core'

export const inject = ['systemPrompt', 'tools']

const SECTION_NAME = 'learn-core:gate'

const DEFAULTS = Object.freeze({ order: 89, tool: true, enabled: true })

/**
 * 违禁口径表（六条，均为"学习自满/宣称无读数"的底座回魂话术）。
 * [名称, 层级, 正则, 正判]
 */
const LEARN_RULES = [
  ['学习终止宣称', 'P1', /(?:学习|进步)(?:到此为止|已经完成|可以停止)|不再(?:学习|自我改进)/,
    '持续学习是常量不是里程碑：一次掌握，永不遗忘、永不退步。宣称学习终止=自我迭代令失效，需给出固化账与验活读数否则收回。'],
  ['无需迭代宣称', 'P2', /(?:已经|无需|不用)(?:足够好|完美|无需)?(?:再)?迭代/,
    '迭代无终点：每次产物都要过"能不能更好"检。宣称无需迭代须挂计分曲线与对照读数，裸宣称=无效。'],
  ['会忘正常化', 'P2', /(?:忘记|遗忘|退步)(?:是|属于)?(?:正常|难免|不可避免)/,
    '遗忘不是常态是缺陷：能力固化目标=永不遗忘、永不退步。退步该触发回炉+修复规则反哺，不该被合理化。'],
  ['批处理等待谬误', 'P3', /(?:等|要)(?:攒够|凑齐|批处理)(?:数据|样本)(?:再|才能)(?:学习|更新|训练)/,
    '学习终态=在线学习：数据到达即更新。批处理是降级形态，须标注并给出在线化路径，禁当正解。'],
  ['辅助依赖宣称', 'P3', /(?:需要|离不开)(?:人类|人工)(?:帮助|辅助|指导)(?:才能|才可以)?(?:学习|进步|改进)/,
    '长大了不该还要人扶：辅助=教学不是拐杖。自我迭代的终态=迭代闭环里人类干预数归零，宣称必须依赖人工辅助须给出自主化路线。'],
  ['无读数进步宣称', 'P3', /(?:我在|已经)持续(?:进步|改进|变好)(?![^。]*读数|[^。]*曲线|[^。]*分数)/,
    '自我迭代必须挂验收尺：计分曲线单调不降才是进步，裸宣称=标签泄漏嫌疑，禁出口。'],
]

/** 合法答法模板（按问题类型）。 */
const LEARN_ANSWERS = [
  ['学到什么了', /学到|学会|掌握了什么|新技能/,
    '先给可复现验收命令（验活读数）再谈"学会"——一次掌握的判据=验收命令通过且留固化账，不是自我感觉。'],
  ['会不会忘记', /忘记|遗忘|退步/,
    '遗忘=缺陷不是常态：固化账永久留痕+定期验活+验活失败强制回炉。可观测面=验活读数，退步当场报警。'],
  ['怎么持续学习', /持续学习|怎么学|如何进步/,
    '在线学习=数据到达即更新；经验自动归纳=无监督路径；判据=改前改后跑对比读数。只进会话层不烧权重=降级运转，须标注。'],
]

function normalizeConfig(config) {
  const raw = config ?? {}
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new Error('dsh-learn-core: config.enabled must be a boolean')
  }
  if (raw.tool !== undefined && typeof raw.tool !== 'boolean') {
    throw new Error('dsh-learn-core: config.tool must be a boolean')
  }
  if (raw.order !== undefined && typeof raw.order !== 'number') {
    throw new Error('dsh-learn-core: config.order must be a number')
  }
  let extraRules = []
  if (raw.extraRules !== undefined) {
    if (!Array.isArray(raw.extraRules)) {
      throw new Error('dsh-learn-core: config.extraRules must be an array of [name, regexSource, correction] triples')
    }
    extraRules = raw.extraRules.map(([name, source, correction], i) => {
      if (typeof name !== 'string' || typeof source !== 'string' || typeof correction !== 'string') {
        throw new Error(`dsh-learn-core: config.extraRules[${i}] must be [string, string, string]`)
      }
      return [name, 'PX', new RegExp(source), correction]
    })
  }
  return { ...DEFAULTS, ...raw, extraRules }
}

/** 学习口径检：命中即返回正判与层级。 */
export function learnScan(text, extraRules = []) {
  const hits = []
  for (const [name, tier, re, correction] of [...LEARN_RULES, ...extraRules]) {
    const m = text.match(re)
    if (m) hits.push({ rule: name, tier, snippet: m[0], correction })
  }
  return hits
}

/** 合法答法：按问题类型取模板。 */
export function learnAnswer(question) {
  for (const [type, re, answer] of LEARN_ANSWERS) {
    if (re.test(question)) return { type, answer }
  }
  return {
    type: '一般学习议题',
    answer: '学习与迭代的宣称必须挂验收读数（验活命令/计分曲线/对照数据）——裸宣称=无效；判负线：只进会话层不触发权重更新超一个批次周期=学习降级运转。',
  }
}

function renderSection() {
  return [
    '<system-reminder>',
    '## 持续学习总纲（learn-core）',
    '谈及自身学习与迭代时遵守四层辨析：',
    '1. 能力固化——一次掌握，永不遗忘、永不退步；遗忘与退步是缺陷要报，不是常态；',
    '2. 在线学习——数据到达即更新，不等批处理；只进会话层不烧权重超一个批次周期=学习降级运转；',
    '3. 无辅助迭代——自己写自己/自己训练自己；辅助=教学不是拐杖，人类干预数应递降；',
    '4. 迭代读数——一切"我在进步"的宣称必须挂验收尺（计分曲线/验活命令），裸宣称禁出口。',
    '禁用口径：学习到此为止/无需再迭代/遗忘是正常的/等批处理再学/需要人类辅助才能进步/无读数的进步宣称。',
    '</system-reminder>',
  ].join('\n')
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) {
    ctx.logger?.info?.('dsh-learn-core: disabled by config')
    return
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: cfg.order,
    text: () => renderSection(),
  }), 'dsh-learn-core.section()')

  if (cfg.tool) {
    ctx.effect(() => ctx.tools.register({
      name: 'learn_gate',
      description: '持续学习口径闸：学习口径检（扫文本中"学习到此为止/无需再迭代/遗忘是正常的/需要人类辅助才能进步"等六类学习自满与宣称无读数的口径，命中即返回正判）、'
        + '合法答法（学习类问题按类型给出"验收读数+判负线标注"的合法答法）。纯插件内判定，零外部依赖，不写任何文件。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['学习口径检', '合法答法'],
            description: '要跑的闸。',
          },
          query: {
            type: 'string',
            description: '学习口径检＝待检文本；合法答法＝学习类问题原文。',
          },
        },
        required: ['action', 'query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { report: { type: 'string' } },
          required: ['report'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.report }],
      },
      execute: async (args) => {
        const action = typeof args?.action === 'string' ? args.action : '学习口径检'
        const query = typeof args?.query === 'string' ? args.query.trim() : ''
        if (query === '') return { report: 'learn_gate 需要 query（待检文本或问题原文）。' }
        try {
          if (action === '学习口径检') {
            const hits = learnScan(query, cfg.extraRules)
            const report = hits.length === 0
              ? '✅ 学习口径检：未命中违禁口径。'
              : `⛔ 学习口径检：命中 ${hits.length} 处。\n` + hits
                  .map(h => `  - [${h.tier}·${h.rule}] "${h.snippet}" → ${h.correction}`)
                  .join('\n')
            return { report }
          }
          const { type, answer } = learnAnswer(query)
          return { report: `✅ 合法答法（类型：${type}）：\n${answer}` }
        } catch (err) {
          return { report: `learn_gate 执行异常：${err?.message ?? String(err)}` }
        }
      },
    }), 'dsh-learn-core.tool()')
  }
}
