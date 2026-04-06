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
  } | null;
};

/** Example JSON shape for documentation in the send pipeline (not a live RPC result). */
const SIMULATION_EXAMPLE_SNIPPET = `{
  "success": false,
  "error": "execution reverted",
  "suggested_access_list": {
    "read": ["0x…"],
    "write": []
  },
  "access_list_covers_suggestion": false
}`;

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

async function resolveApproval(requestId: string, approved: boolean): Promise<void> {
  await sendRuntimeMessage({ type: 'RESOLVE_SIGN_APPROVAL', requestId, approved });
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
  if (txPipeline === 'sign') {
    const li = document.createElement('li');
    li.textContent = 'Sign locally and return the hex to the dApp — nothing is broadcast.';
    ol.appendChild(li);
    return;
  }
  const steps = [
    'Sign the transaction with your approved key.',
    'Call boing_simulateTransaction on the selected RPC with the signed bytes.',
    'If simulation succeeds (or the node has no simulator), call boing_submitTransaction.',
    'If simulation reports failure, the transaction is not submitted; the dApp may receive suggested_access_list in the error data.',
  ];
  for (const text of steps) {
    const li = document.createElement('li');
    li.textContent = text;
    ol.appendChild(li);
  }
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
  const simExampleWrap = $('approval-sim-example-wrap');
  const simExamplePre = $('approval-sim-example');
  const messageBlock = $('approval-message-block');

  if (detail) {
    document.title = 'Approve transaction';
    titleEl.textContent = 'Approve transaction';
    subtitleEl.textContent = 'Review the transaction fields below before approving.';
    txSection.classList.remove('hidden');
    messageBlock.classList.add('hidden');
    fillTxTable($('approval-tx-tbody') as HTMLTableSectionElement, detail.rows);

    if (txPipeline === 'sign' || txPipeline === 'send') {
      pipelineSection.classList.remove('hidden');
      $('approval-pipeline-title').textContent = txPipeline === 'send' ? 'Sign & send pipeline' : 'Sign-only pipeline';
      fillPipelineSteps($('approval-pipeline-steps') as HTMLOListElement, txPipeline);
      if (txPipeline === 'send') {
        simExampleWrap.classList.remove('hidden');
        simExamplePre.textContent = SIMULATION_EXAMPLE_SNIPPET;
      } else {
        simExampleWrap.classList.add('hidden');
        simExamplePre.textContent = '';
      }
    } else {
      pipelineSection.classList.add('hidden');
      simExampleWrap.classList.add('hidden');
    }
  } else {
    document.title = 'Approve signature';
    titleEl.textContent = 'Approve signature';
    subtitleEl.textContent = 'Review this message carefully before approving.';
    txSection.classList.add('hidden');
    pipelineSection.classList.add('hidden');
    simExampleWrap.classList.add('hidden');
    messageBlock.classList.remove('hidden');
    $('approval-message').textContent = approval.message;
  }

  $('btn-approve').addEventListener('click', async () => {
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
