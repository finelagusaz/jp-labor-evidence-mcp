/** e-Gov API v2 のレスポンス型 */

export interface EgovLawSearchResult {
  law_info: {
    law_id: string;
    law_type: string;
    law_num: string;
    promulgation_date: string;
  };
  revision_info?: {
    law_title: string;
    law_title_kana?: string;
    abbrev?: string;
  };
  current_revision_info?: {
    law_title: string;
    law_title_kana?: string;
    abbrev?: string;
  };
}

export interface EgovLawData {
  law_info: {
    law_id: string;
    law_type: string;
    law_num: string;
    law_num_era?: string;
    law_num_year?: number;
    law_num_type?: string;
    law_num_num?: string;
    promulgation_date: string;
  };
  law_full_text: EgovNode;
}

export interface EgovNode {
  tag: string;
  attr?: Record<string, string>;
  children?: (EgovNode | string)[];
}

/** MHLW 法令等データベース — 検索結果 */

export interface MhlwSearchResult {
  /** 通達タイトル */
  title: string;
  /** dataId（文書の一意識別子） */
  dataId: string;
  /** 制定年月日 */
  date: string;
  /** 種別・番号（例: "基発第0401001号"） */
  shubetsu: string;
}

/** MHLW 法令等データベース — 通達本文 */

export interface MhlwDocument {
  /** ドキュメントタイトル */
  title: string;
  /** 本文テキスト */
  body: string;
  /** 制定年月日 */
  date?: string;
  /** 種別・番号 */
  number?: string;
  /** dataId */
  dataId: string;
  /** ソースURL */
  url: string;
}

/** JAISH 安全衛生情報センター — インデックスエントリ */

export interface JaishIndexEntry {
  /** 通達タイトル */
  title: string;
  /** 通達番号（例: "基発第123号"） */
  number: string;
  /** 発出日 */
  date: string;
  /** ページURL（相対パスまたは絶対URL） */
  url: string;
}

/** JAISH 安全衛生情報センター — 通達本文 */

export interface JaishDocument {
  /** 通達タイトル */
  title: string;
  /** 本文テキスト */
  body: string;
  /** 発出日 */
  date?: string;
  /** 通達番号 */
  number?: string;
  /** ソースURL */
  url: string;
}

export interface PartialFailure {
  source: string;
  target: string;
  reason: string;
}

export interface WarningMessage {
  code: string;
  message: string;
}
