import { assessOrigin } from '../src/security/originRisk';
import { tipPlanFromWire, type TipPlanWire } from '../src/boing/tipPlan';
import { renderApprovalFeeIsland } from './approvalFeeIsland';

type TransactionApprovalDetail = {
  txType: string;
  summaryLine: string;
  rows: { label: string; value: string }[];
};

type ApprovalResponse = {
  ok: boolean;
  approval: {
    requestId: string;
    origin: string;
    chainId: string;
    address: string;
    message: string;
    transactionDetail?: TransactionApprovalDetail;
    txPipeline?: 'sign' | 'send';
    kind?: 'connect' | 'sign';
    tipPlan?: TipPlanWire;
  } | null;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function showError(message: string): void {
  const el = $('approval-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

function setBusy(isBusy: boolean): void {
  const approve = $('btn-approve') as HTMLButtonElement;
  const reject = $('btn-reject') as HTMLButtonElement;
  approve.disabled = isBusy;
  reject.disabled = isBusy;
}

function parseRequestId(): string {
  return new URLSearchParams(window.location.search).get('requestId') ?? '';
}

async function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/** Priority tip picked in the speed chooser (base units); 0 when none / not shown. */
let chosenTip = 0n;
let chosenTipValid = true;

async function resolveApproval(requestId: string, approved: boolean): Promise<void> {
  await sendRuntimeMessage({
    type: 'RESOLVE_SIGN_APPROVAL',
    requestId,
    approved,
    ...(approved && chosenTip > 0n ? { priorityTip: chosenTip.toString() } : {}),
  });
  window.close();
}

function fillTxTable(tbody: HTMLTableSectionElement, rows: { label: string; value: string }[]): void {
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = row.label;
    const td = document.createElement('td');
    td.className = 'tx-cell-value';
    td.textContent = row.value;
    tr.append(th, td);
    tbody.appendChild(tr);
  }
}

function fillPipelineSteps(ol: HTMLOListElement, txPipeline: 'sign' | 'send'): void {
  ol.replaceChildren();
  const steps =
    txPipeline === 'sign'
      ? ['Your wallet signs this transaction on your device.', 'The signed transaction is handed back to the site. Nothing is sent to the network by this approval.']
      : [
          'Your wallet signs this transaction on your device.',
          'The network does a dry run first. If it would fail, nothing is sent and you are told why.',
          'If the dry run passes, the transaction is sent to the network.',
        ];
  for (const text of steps) {
    const li = document.createElement('li');
    li.textContent = text;
    ol.appendChild(li);
  }
}

function showOriginRisk(origin: string): void {
  const risk = assessOrigin(origin);
  const el = $('approval-risk');
  if (risk.level === 'none') {
    el.classList.add('hidden');
    return;
  }
  el.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = risk.level === 'danger' ? 'Be careful: this site looks risky' : 'Check this site before continuing';
  const ul = document.createElement('ul');
  for (const w of risk.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  }
  el.append(strong, ul);
  el.classList.toggle('risk-danger', risk.level === 'danger');
  el.classList.remove('hidden');
}
async function main(): Promise<void> {
  const requestId = parseRequestId();
  if (!requestId) {
    showError('Missing approval request id.');
    setBusy(true);
    return;
  }

  const response = await sendRuntimeMessage<ApprovalResponse>({
    type: 'GET_SIGN_APPROVAL',
    requestId,
  });

  if (!response.ok || !response.approval) {
    showError('This signing request is no longer available.');
    setBusy(true);
    return;
  }

  const { approval } = response;
  $('approval-origin').textContent = approval.origin;
  $('approval-chain').textContent = approval.chainId;
  $('approval-address').textContent = approval.address;

  const detail = approval.transactionDetail;
  const txPipeline = approval.txPipeline;
  const titleEl = $('approval-title');
  const subtitleEl = $('approval-subtitle');
  const txSection = $('approval-tx-section');
  const pipelineSection = $('approval-pipeline-section');
  const messageBlock = $('approval-message-block');
  showOriginRisk(approval.origin);

  if (approval.kind === 'connect') {
    document.title = 'Connect to site';
    titleEl.textContent = 'Connect to this site?';
    subtitleEl.textContent =
      'This site will be able to see your address and ask you to approve transactions and signatures. It cannot move your funds without your approval each time.';
    txSection.classList.add('hidden');
    pipelineSection.classList.add('hidden');
    messageBlock.classList.add('hidden');
    $('btn-approve').textContent = 'Connect';
  } else if (detail) {
    document.title = 'Approve transaction';
    titleEl.textContent = 'Approve transaction';
    subtitleEl.textContent = 'Check the amount and recipient below. Approve only if you started this action.';
    txSection.classList.remove('hidden');
    messageBlock.classList.add('hidden');
    fillTxTable($('approval-tx-tbody') as HTMLTableSectionElement, detail.rows);

    const tipPlan = tipPlanFromWire(approval.tipPlan);
    if (tipPlan.allowed || tipPlan.locked != null) {
      $('approval-fee-section').classList.remove('hidden');
      renderApprovalFeeIsland($('approval-fee-root'), tipPlan, (tip, valid) => {
        chosenTip = tip;
        chosenTipValid = valid;
        ($('btn-approve') as HTMLButtonElement).disabled = !valid;
      });
    }

    if (txPipeline === 'sign' || txPipeline === 'send') {
      pipelineSection.classList.remove('hidden');
      fillPipelineSteps($('approval-pipeline-steps') as HTMLOListElement, txPipeline);
    } else {
      pipelineSection.classList.add('hidden');
    }
  } else {
    document.title = 'Approve signature';
    titleEl.textContent = 'Approve signature';
    subtitleEl.textContent = 'Signing proves you own this address. It does not send funds. Read the message and approve only if you trust this site.';
    txSection.classList.add('hidden');
    pipelineSection.classList.add('hidden');
    messageBlock.classList.remove('hidden');
    $('approval-message').textContent = approval.message;
  }
  $('btn-approve').addEventListener('click', async () => {
    if (!chosenTipValid) return;
    setBusy(true);
    try {
      await resolveApproval(requestId, true);
    } catch (error) {
      setBusy(false);
      showError(error instanceof Error ? error.message : 'Failed to approve request.');
    }
  });

  $('btn-reject').addEventListener('click', async () => {
    setBusy(true);
    try {
      await resolveApproval(requestId, false);
    } catch (error) {
      setBusy(false);
      showError(error instanceof Error ? error.message : 'Failed to reject request.');
    }
  });
}

main().catch((error) => {
  showError(error instanceof Error ? error.message : 'Failed to load signing request.');
  setBusy(true);
});
