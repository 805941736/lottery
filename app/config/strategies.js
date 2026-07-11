export const PICK_LINE_LABELS = Object.freeze({ 1: "自选", 2: "机选1", 3: "机选2" });
export const RETIRED_DEFAULT_STRATEGY_IDS = Object.freeze(["hot", "repeat", "neighbor"]);
export const AI_STRATEGY_ID = "ai";
export const DEFAULT_STRATEGIES = Object.freeze([
  { id: "short-trend", mode: "hot", name: "短趋判断", weight: 1.1, explain: "用最近10期判断当前连号、分布和局部结构趋势，决定其它策略的权重。", example: "示例：近10期多为29-30、32-33，说明2连和高位尾段活跃；若多次出现16-17-18，则提高3连观察权重。" },
  { id: "similar-backtrack", mode: "hot", name: "相似回溯", weight: 1.05, explain: "以上期为起点，在近20期内寻找相似但不完全相同的结构，再观察后续可能的重复、映射和变形。", example: "示例：上期高位密集，就回看近20期是否有类似高位密集，并观察之后是否转向28、31、33附近。" },
  { id: "hot-cycle", mode: "zone", name: "热区周期", weight: 1, explain: "用50期判断大环境，识别热区延续、过热、结束或切换，不机械延续热号区。", example: "示例：多组连号和尾段密集集中爆发时，可能说明旧热区过热，需要观察新周期。" },
  { id: "expect-pair", mode: "neighbor", name: "预期对偶", weight: 1.15, explain: "当竖线、斜线或连号让人感觉要继续时，重点观察原线左侧或右侧一位。", example: "示例：竖着连续出现30，不只看30，也看29、31；斜线延续时同样看两侧偏移位。" },
  { id: "shape-map", mode: "zone", name: "结构映射", weight: 1.05, explain: "看号码之间的形状关系，前期局部结构可能平移、变形后在其他区间重复。", example: "示例：01-04-07一类低区骨架，后面可能映射成12-14-17或13-16-19这样的相似结构。" },
  { id: "vertical-gap", mode: "repeat", name: "等距竖列", weight: 0.9, explain: "某个号码按固定期距纵向重复时形成周期感，但必须结合走势共振，不能机械套用。", example: "示例：某号隔3期重复，若邻号、热区、斜线或机选提示也支持，则提高观察权重；孤立等距则降权。" },
  { id: "mirror-shape", mode: "repeat", name: "对称结构", weight: 0.95, explain: "观察A-B-B-A、A-B-A等镜像或夹心形态，判断是否存在回摆、外扩或平移。", example: "示例：01、02、02、01形成对称结构，后续可看自身、外扩03，或平移到其他区间。" },
  { id: "shape-turn", mode: "neighbor", name: "结构转置", weight: 0.95, explain: "同一组骨架号不按原形重复，而是横竖、左右或重心发生变化后再次出现。", example: "示例：21、23、24上方是右侧展开，下方可能转成21竖向加强，同时23、24保留。" },
  { id: "fixed-pair", mode: "repeat", name: "固定搭配", weight: 1.1, explain: "高位号码容易形成固定或近似固定搭配，重点观察28+32、29+33、31+33。", example: "示例：31-33尾段活跃时，提高31+33、29+33等组合或其邻近结构的权重。" },
  { id: "edge-swap", mode: "neighbor", name: "首尾互换", weight: 0.85, explain: "边界号可能隔期呼应，本期出现01或33时，下一期观察另一端边界号。", example: "示例：上期有33，下一期把01放入候选观察；上期有01，则观察33。" },
  { id: "random-hint", mode: "neighbor", name: "机选提示", weight: 1.05, explain: "把机选号本身、相邻号和连续号放进走势图验证，机选用于修正而不是直接照抄。", example: "示例：机选08时，同时观察07、08、09，以及07-08、08-09是否贴合短趋和结构。" },
  { id: "group-shape", mode: "zone", name: "组号结构", weight: 0.8, explain: "最终6个红球常按2-2-1-1思考，但不强制，需根据短趋和周期灵活调整。", example: "示例：可用固定搭配2个、结构映射2个、新变化1个、机选提示1个；周期切换时可改为更分散结构。" },
  { id: "odd-extend", mode: "neighbor", name: "反常延续", weight: 0.9, explain: "当结构长到多数人觉得该断时，如果短趋仍支持，保留继续延伸的可能。", example: "示例：已经出现斜4连，仍可保留第5个延伸点，但需有近期趋势支撑。" },
  { id: AI_STRATEGY_ID, mode: "ai", name: "AI", weight: 1, explain: "\u624b\u52a8\u8f93\u5165 AI \u9884\u6d4b\u53f7\u7801\uff0c\u4e0d\u4e0e\u5176\u4ed6\u7b56\u7565\u4ea4\u53c9", example: "\u4f8b\u598201 06 12 18 26 31 08" }
]);
