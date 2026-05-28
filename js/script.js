// =========================================================
//  スイスドロー記録分布推定ツール
// =========================================================

// ---------------------------------------------------------
//  【ロジック】規定ラウンド数算出（付録E）
// ---------------------------------------------------------

/**
 * bye保持者を含む実効人数を計算する。
 * 1bye=2人分、2bye=4人分、3bye=8人分として換算。
 */
function calcEffectivePlayers(total, bye1, bye2, bye3) {
  const normalPlayers = total - bye1 - bye2 - bye3;
  return normalPlayers + bye1 * 2 + bye2 * 4 + bye3 * 8;
}

/**
 * 実効人数と決勝ドラフト有無から規定ラウンド数を返す。
 * 戻り値: { rounds: number|null, noSwiss: boolean, swissInfo: string }
 * noSwiss=trueの場合はスイスなし（SE方式）。
 */
function calcOfficialRounds(effectivePlayers, hasFinalDraft) {
  if (effectivePlayers <= 4) {
    return { rounds: 2, noSwiss: true, swissInfo: 'SE2ラウンド（スイスなし）' };
  } else if (effectivePlayers <= 8) {
    return { rounds: 3, noSwiss: true, swissInfo: 'SE3ラウンド（スイスなし）' };
  } else if (effectivePlayers <= 16) {
    const r = hasFinalDraft ? 4 : 5;
    return { rounds: r, noSwiss: false, swissInfo: null };
  } else if (effectivePlayers <= 32) {
    return { rounds: 5, noSwiss: false, swissInfo: null };
  } else if (effectivePlayers <= 64) {
    return { rounds: 6, noSwiss: false, swissInfo: null };
  } else if (effectivePlayers <= 128) {
    return { rounds: 7, noSwiss: false, swissInfo: null };
  } else if (effectivePlayers <= 226) {
    return { rounds: 8, noSwiss: false, swissInfo: null };
  } else if (effectivePlayers <= 409) {
    return { rounds: 9, noSwiss: false, swissInfo: null };
  } else {
    return { rounds: 10, noSwiss: false, swissInfo: null };
  }
}

/**
 * 実効人数・決勝ドラフト有無・スイスなしフラグから自動カットモードを返す。
 * 付録E の決勝ラウンド列に準拠:
 *   スイスなし → none
 *   9-16 + 決勝ドラフトあり → top8
 *   9-16 + 決勝ドラフトなし → top4
 *   17以上 → top8
 */
function calcAutoCutMode(effectivePlayers, hasFinalDraft, noSwiss) {
  if (noSwiss) return 'none';
  if (effectivePlayers <= 16) return hasFinalDraft ? 'top8' : 'top4';
  return 'top8';
}

// ---------------------------------------------------------
//  【ロジック】スイスドロー分布計算
// ---------------------------------------------------------

/**
 * 1ラウンドの分布遷移を計算する。
 * dist: { wins: count } のオブジェクト
 * round: 1-indexed ラウンド番号（bye合流タイミングに使用）
 * 戻り値: 新しい分布オブジェクト
 */
function simulateRound(dist, round, bye1, bye2, bye3) {
  // bye合流: ラウンドr開始時にb=r-1のbye保持者が (r-1)-0 で合流
  const d = Object.assign({}, dist);
  const b = round - 1;
  if (b === 1 && bye1 > 0) d[b] = (d[b] || 0) + bye1;
  if (b === 2 && bye2 > 0) d[b] = (d[b] || 0) + bye2;
  if (b === 3 && bye3 > 0) d[b] = (d[b] || 0) + bye3;

  // 勝ち数の高い順に処理（ペアダウン勝者前提）
  const sortedWins = Object.keys(d).map(Number).sort((a, b) => b - a);
  const result = {};
  let pairDown = 0; // 上グループからのペアダウン要員 (0 or 1)

  for (const w of sortedWins) {
    let n = d[w];

    // ペアダウン処理: 上グループからの1人が現グループの1人に勝つ
    if (pairDown > 0) {
      result[w + 2] = (result[w + 2] || 0) + 1; // ペアダウン要員は w+1 → w+2
      result[w]     = (result[w]     || 0) + 1; // 敗北者は w に留まる
      n -= 1; // 現グループの内部ペアリング対象から1人除外
      pairDown = 0;
    }

    // グループ内ペアリング
    const pairs = Math.floor(n / 2);
    const rem   = n % 2;
    result[w + 1] = (result[w + 1] || 0) + pairs; // 勝者
    result[w]     = (result[w]     || 0) + pairs; // 敗者

    // 奇数余りは下グループへペアダウン
    if (rem === 1) pairDown = 1;
  }

  // 最下グループでも余りが出た場合はwalkover bye（実際大会ではほぼ発生しない）
  if (pairDown > 0) {
    const lowestW = Math.min(...sortedWins);
    result[lowestW + 1] = (result[lowestW + 1] || 0) + 1;
  }

  return result;
}

/**
 * 全ラウンドの分布スナップショット配列を返す。
 * 戻り値: [{ round: 1, dist: {...} }, { round: 2, dist: {...} }, ...]
 */
function simulateAllRounds(total, bye1, bye2, bye3, rounds) {
  // 通常参加者（byeなし）をラウンド開始前に 0勝 で配置
  const normalPlayers = total - bye1 - bye2 - bye3;
  let dist = normalPlayers > 0 ? { 0: normalPlayers } : {};

  const snapshots = [];
  for (let r = 1; r <= rounds; r++) {
    dist = simulateRound(dist, r, bye1, bye2, bye3);
    snapshots.push({ round: r, dist: Object.assign({}, dist) });
  }
  return snapshots;
}

// ---------------------------------------------------------
//  【自動テスト】ロジック検証（コンソール出力のみ）
// ---------------------------------------------------------

function runTests() {
  const results = [];
  function assert(label, actual, expected) {
    results.push({ label, ok: actual === expected, actual, expected });
  }

  // 規定ラウンド数
  const eff1 = calcEffectivePlayers(226, 0, 0, 0);
  assert('実効人数: 226人byeなし=226', eff1, 226);
  assert('規定ラウンド: 実効226人→8', calcOfficialRounds(eff1, false).rounds, 8);

  const eff2 = calcEffectivePlayers(227, 0, 0, 0);
  assert('実効人数: 227人byeなし=227', eff2, 227);
  assert('規定ラウンド: 実効227人→9', calcOfficialRounds(eff2, false).rounds, 9);

  const eff3 = calcEffectivePlayers(125, 5, 0, 0);
  assert('実効人数: 120人+1bye×5=130', eff3, 130);
  assert('規定ラウンド: 実効130人→8', calcOfficialRounds(eff3, false).rounds, 8);

  assert('規定ラウンド: 実効128人→7', calcOfficialRounds(128, false).rounds, 7);
  assert('規定ラウンド: 実効129人→8', calcOfficialRounds(129, false).rounds, 8);
  assert('規定ラウンド: 実効16人+決勝ドラフト→4', calcOfficialRounds(16, true).rounds, 4);
  assert('規定ラウンド: 実効16人なし→5', calcOfficialRounds(16, false).rounds, 5);

  // 分布計算
  const snaps = simulateAllRounds(226, 0, 0, 0, 2);
  const d2 = snaps[1].dist;
  assert('分布R2: 226人 2-0=57', d2[2], 57);
  assert('分布R2: 226人 1-1=112', d2[1], 112);
  assert('分布R2: 226人 0-2=57', d2[0], 57);
  assert('分布R2: 合計=226', Object.values(d2).reduce((a, b) => a + b, 0), 226);

  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    failures.forEach(r => console.error(`[TEST FAIL] ${r.label} → 期待値:${r.expected} 実際:${r.actual}`));
  }
  return results;
}

// ---------------------------------------------------------
//  UIイベント登録
// ---------------------------------------------------------

function onRoundModeChange() {
  const manual = document.querySelector('input[name="roundMode"]:checked').value === 'manual';
  document.getElementById('manualRoundRow').style.display = manual ? 'flex' : 'none';
  recalculate();
}

function attachListeners() {
  ['totalPlayers','bye1','bye2','bye3','manualRounds','finalDraft'].forEach(id =>
    document.getElementById(id).addEventListener('input', recalculate));
  document.querySelectorAll('input[name="roundMode"]').forEach(r => r.addEventListener('change', onRoundModeChange));
  document.querySelectorAll('input[name="cutMode"]').forEach(r => r.addEventListener('change', recalculate));
}

// ---------------------------------------------------------
//  【描画】ラウンドごとの三角形グリッド
// ---------------------------------------------------------

/**
 * 各ラウンドの分布を三角形グリッドで描画する。
 * 各行 = 1ラウンド、各セル = (勝ち数)-(負け数): 人数
 */
function renderGrid(container, snapshots, rounds) {
  const section = document.createElement('div');
  section.className = 'output-section';

  const h = document.createElement('h2');
  h.textContent = 'ラウンド別記録分布グリッド';
  section.appendChild(h);

  const table = document.createElement('table');
  table.className = 'grid-table';

  // ヘッダー行: 最大の勝ち負け数の組み合わせ
  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  const thR = document.createElement('th');
  thR.textContent = 'R';
  hRow.appendChild(thR);
  // 最終ラウンド後の勝ち数列: rounds → 0
  for (let w = rounds; w >= 0; w--) {
    const l = rounds - w;
    const th = document.createElement('th');
    th.textContent = `${w}勝`;
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  snapshots.forEach(({ round, dist }) => {
    const tr = document.createElement('tr');
    const tdR = document.createElement('td');
    tdR.textContent = `R${round}`;
    tr.appendChild(tdR);
    // ヘッダーと同じ列順（w=rounds → 0）でセルを生成
    for (let w = rounds; w >= 0; w--) {
      const td = document.createElement('td');
      if (w <= round) {
        // このラウンドで達成可能な記録
        const count = dist[w] || 0;
        td.textContent = count > 0 ? count : '';
      } else {
        // まだ到達不能（三角形の空白部分）
        td.className = 'grid-empty';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  section.appendChild(table);
  container.appendChild(section);
}

// ---------------------------------------------------------
//  【描画】最終ラウンド記録別人数テーブル＋カット強調
// ---------------------------------------------------------

/**
 * カット閾値を特定する。
 * Top8/Top4 の場合、上位N人に入る最低勝ち数を返す。
 * 戻り値: { cutWins: number, cumulative: number }
 */
function calcCutLine(dist, rounds, cutMode) {
  if (cutMode === 'none') return null;
  const cutN = cutMode === 'top8' ? 8 : 4;
  // 高い勝ち数から累積して cutN 人に達する最低勝ち数
  let cumulative = 0;
  for (let w = rounds; w >= 0; w--) {
    const count = dist[w] || 0;
    if (count === 0) continue;
    cumulative += count;
    if (cumulative >= cutN) {
      return { cutWins: w, cumulative };
    }
  }
  return null;
}

/**
 * 最終ラウンドの記録別人数テーブルを描画する。
 * カットライン強調あり。
 */
function renderFinalTable(container, dist, rounds, cutMode) {
  const section = document.createElement('div');
  section.className = 'output-section';

  const h = document.createElement('h2');
  h.textContent = `最終（R${rounds}終了後）記録別人数`;
  section.appendChild(h);

  const cutLine = calcCutLine(dist, rounds, cutMode);

  const table = document.createElement('table');
  table.className = 'final-table';

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  ['記録', '人数'].forEach(t => {
    const th = document.createElement('th');
    th.textContent = t;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let w = rounds; w >= 0; w--) {
    const l = rounds - w;
    const count = dist[w] || 0;
    if (count === 0) continue;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = `${w}-${l}`;
    const tdCount = document.createElement('td');
    tdCount.textContent = count;

    // カット強調
    if (cutLine && w >= cutLine.cutWins) {
      tr.classList.add('cut-highlight');
    } else if (cutLine && w === cutLine.cutWins - 1) {
      tr.classList.add('cut-border');
    }

    tr.appendChild(tdLabel);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);

  if (cutLine) {
    const note = document.createElement('p');
    note.className = 'cut-note';
    const cutN = cutMode === 'top8' ? 8 : 4;
    note.textContent = `${cutMode.toUpperCase()} カットライン: ${cutLine.cutWins}勝以上（累積 ${cutLine.cumulative}人）`;
    section.appendChild(note);
  }

  container.appendChild(section);
}

// ---------------------------------------------------------
//  【描画】「X勝以上」累積人数テーブル
// ---------------------------------------------------------

function renderCumulativeTable(container, dist, rounds, cutMode) {
  const section = document.createElement('div');
  section.className = 'output-section';

  const h = document.createElement('h2');
  h.textContent = 'X勝以上の累積人数';
  section.appendChild(h);

  const cutLine = calcCutLine(dist, rounds, cutMode);

  const table = document.createElement('table');
  table.className = 'final-table';

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  ['X勝以上', '累積人数'].forEach(t => {
    const th = document.createElement('th');
    th.textContent = t;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let cumulative = 0;
  for (let w = rounds; w >= 0; w--) {
    cumulative += (dist[w] || 0);
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = `${w}勝以上`;
    const tdCount = document.createElement('td');
    tdCount.textContent = cumulative;

    if (cutLine && w >= cutLine.cutWins) {
      tr.classList.add('cut-highlight');
    }

    tr.appendChild(tdLabel);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  container.appendChild(section);
}

// ---------------------------------------------------------
//  メイン計算・描画
// ---------------------------------------------------------

function recalculate() {
  const fragInfo   = document.createDocumentFragment();
  const fragGrid   = document.createDocumentFragment();
  const fragTables = document.createDocumentFragment();

  // 入力値を取得
  const total    = parseInt(document.getElementById('totalPlayers').value) || 0;
  const bye1     = parseInt(document.getElementById('bye1').value) || 0;
  const bye2     = parseInt(document.getElementById('bye2').value) || 0;
  const bye3     = parseInt(document.getElementById('bye3').value) || 0;
  const hasFinalDraft = document.getElementById('finalDraft').checked;
  const roundMode = document.querySelector('input[name="roundMode"]:checked').value;
  const manualRounds = parseInt(document.getElementById('manualRounds').value) || 1;

  // 実効人数・規定ラウンド数を計算
  const effectivePlayers = calcEffectivePlayers(total, bye1, bye2, bye3);
  const official = calcOfficialRounds(effectivePlayers, hasFinalDraft);
  const rounds = roundMode === 'auto' ? official.rounds : manualRounds;

  const isNoSwiss = official.noSwiss && roundMode === 'auto';

  if (!isNoSwiss && total > 0) {
    // カットモードを解決（自動の場合は付録Eの決勝ラウンド列から導出）
    const cutModeRaw = document.querySelector('input[name="cutMode"]:checked').value;
    const cutMode = cutModeRaw === 'auto'
      ? calcAutoCutMode(effectivePlayers, hasFinalDraft, official.noSwiss)
      : cutModeRaw;

    // 全ラウンドの分布を計算
    const snapshots = simulateAllRounds(total, bye1, bye2, bye3, rounds);

    // グリッド
    renderGrid(fragGrid, snapshots, rounds);

    // 算出情報
    const infoSection = document.createElement('div');
    infoSection.className = 'input-section';
    const infoH = document.createElement('h2');
    infoH.textContent = '算出情報';
    infoSection.appendChild(infoH);

    const infoText = document.createElement('p');
    infoText.style.cssText = 'font-size:0.9rem;margin-bottom:0.25rem;';
    infoText.textContent = `実効人数: ${effectivePlayers}人（総参加者:${total}, 1bye:${bye1}, 2bye:${bye2}, 3bye:${bye3}）`;
    infoSection.appendChild(infoText);

    const roundText = document.createElement('p');
    roundText.style.cssText = 'font-size:0.9rem;';
    roundText.textContent = `規定ラウンド数: ${official.rounds} ／ 使用ラウンド数: ${rounds}${roundMode === 'manual' ? '（手動指定）' : ''}`;
    infoSection.appendChild(roundText);

    if (cutModeRaw === 'auto') {
      const cutLabel = { top8: 'Top8', top4: 'Top4', none: 'なし' }[cutMode];
      const cutText = document.createElement('p');
      cutText.style.cssText = 'font-size:0.9rem;';
      cutText.textContent = `自動カット: ${cutLabel}`;
      infoSection.appendChild(cutText);
    }
    fragInfo.appendChild(infoSection);

    // 記録別人数・累積人数
    renderFinalTable(fragTables, snapshots[snapshots.length - 1].dist, rounds, cutMode);
    renderCumulativeTable(fragTables, snapshots[snapshots.length - 1].dist, rounds, cutMode);
  }

  document.getElementById('output-grid').replaceChildren(fragGrid);
  document.getElementById('output-info').replaceChildren(fragInfo);
  document.getElementById('output-tables').replaceChildren(fragTables);
  document.getElementById('output-top').style.display = isNoSwiss ? 'none' : '';

}

attachListeners();
recalculate();
runTests();
