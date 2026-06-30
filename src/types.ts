// JSON Schema Analyzer 类型定义

export interface FlatSchemaItem {
  path: string;
  type: string;
  sampleValue?: any;
  itemTypes?: ItemTypeEntry[];
  presence?: number;
  note?: string;
  comment?: string;
  longText?: boolean;
  originalLength?: number;
  variants?: VariantEntry[];
  keys?: string[];
}

export interface ItemTypeEntry {
  type: string;
  count: number;
  samples?: any[];
}

export interface VariantEntry {
  type: string;
  count: number;
  samples?: any[];
}

// ---------- analyze 选项 ----------

export interface AnalyzeOptions {
  /** 最大递归深度 (默认 32) */
  maxDepth?: number;
  /** 每个数组最多分析的元素数 (默认 5000)，超出的只计数不展开 */
  maxArrayItems?: number;
  /** 每个 object 节点最多列举的 key 数 (默认 500)，超出的计数但省略列表 */
  maxKeysPerObject?: number;
  /** 每种类型最多收集的样本数 (默认 3) */
  sampleCount?: number;
}

// ---------- summary 类型 ----------

export interface AnalyzeSummary {
  totalNodes: number;
  maxDepth: number;
  arraysCount: number;
  objectsCount: number;
  mixedFields: number;
  longTextFields: number;
  emptyArrays: number;
  leafTypes: Record<string, number>;
  /** 被截断的数组数 */
  truncatedArrays: number;
  /** 被截断的对象数 */
  truncatedObjects: number;
}

// ---------- getByPath ----------

export interface GetByPathOptions {
  /** 最大返回条数 (默认 100) */
  limit?: number;
  /** 最大递归深度 (默认 64) */
  maxDepth?: number;
}

// ---------- explore ----------

export interface FieldValueResult {
  values: any[];
  /** 去重值数 */
  distinct: number;
  /** 总采样数 */
  totalVisited: number;
  truncated: boolean;
}

export interface CardinalityResult {
  distinct: number;
  total: number;
  truncated: boolean;
}

// ---------- 路径解析工具类型 ----------

export interface PathSegment {
  type: "key" | "wildcard" | "index" | "globstar" | "filter";
  value?: string;  // key name / index / filter expression ("key~pattern" or "key=pattern")
}
