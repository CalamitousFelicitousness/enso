export interface DictInfo {
  name: string;
  version: string;
  tag_count: number;
  categories: Record<string, string>;
  size: number;
}

export interface DictCategory {
  name: string;
  color: string;
}

export interface DictContent {
  name: string;
  version: string;
  categories: Record<string, DictCategory>;
  tags: [string, number, number][]; // [name, category_id, post_count]
}

export interface DictTag {
  name: string;
  category: number;
  count: number;
}
