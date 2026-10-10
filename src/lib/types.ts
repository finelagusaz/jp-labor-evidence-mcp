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

/** e-Gov law_data.revision_info の v1 で用いる部分集合（防御的に全 optional/nullable） */
export interface EgovRevisionInfo {
  law_revision_id?: string | null;
  amendment_enforcement_date?: string | null;
  amendment_enforcement_comment?: string | null;
  /** 版を生んだ改正の施行予定日。未施行の版では amendment_enforcement_date が null で、こちらにだけ日付が入る */
  amendment_scheduled_enforcement_date?: string | null;
  amendment_law_num?: string | null;
  amendment_law_title?: string | null;
  amendment_law_id?: string | null;
  current_revision_status?: string | null;
  repeal_status?: string | null;
  repeal_date?: string | null;
}

/** get_article / evidence-bundle の Evidence に載る機械可読 版メタ（すべて optional・null は含めない） */
export interface RevisionMetadata {
  law_revision_id?: string;
  current_enforcement_date?: string;
  /** current_enforcement_date の和暦（「令和8年6月24日」） */
  current_enforcement_date_wareki?: string;
  /** 未施行の版の施行予定日（current_revision_status が UnEnforced のときだけ） */
  scheduled_enforcement_date?: string;
  scheduled_enforcement_date_wareki?: string;
  enforcement_note?: string;
  amendment_law_num?: string;
  amendment_law_title?: string;
  current_revision_status?: string;
  repeal_status?: string;
  version_pinned_url?: string;
  latest_enforced_verified?: true;
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
  revision_info?: EgovRevisionInfo;
}

/** e-Gov /law_revisions（法令履歴一覧）レスポンス */
export interface EgovLawRevisionsResponse {
  law_info?: EgovLawData['law_info'];
  revisions?: EgovRevisionInfo[];
}

/** get_article の pending_amendments 各件（施行日昇順） */
export interface PendingAmendment {
  enforcement_date: string;       // = amendment_enforcement_date（除外により出力では常在）
  enforcement_date_wareki?: string; // enforcement_date の和暦（「令和9年4月1日」）
  amendment_law_num?: string;
  amendment_law_title?: string;
  law_revision_id?: string;
  version_pinned_url?: string;
  enforcement_note?: string;      // = amendment_enforcement_comment
  repeal_status?: string;
  /** 改正法の ID（amendment_law_id。無ければ版の ID の末尾から）。一部改正法の本文は e-Gov API に無い */
  amendment_law_id?: string;
  /** 同じ改正法の未施行の版が複数あるとき（段階施行）だけ: 施行予定日の早い順で何期目か */
  phase?: number;
  phase_count?: number;
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
