<?php
// Offline transport: execute actual dispatchers; spies replace only network sends.
declare(strict_types=1);
define('MAX_API_TEST_MODE', true);
define('IB_HANDOFF_TEST', true);
$mode = $argv[1];
$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$GLOBALS['emissions'] = [];
function respond_to_order_query(int $id, string $text): void { $GLOBALS['emissions'][] = ['id'=>$id, 'text'=>$text]; }
if ($mode === 'handoff') {
    require __DIR__ . '/../scripts/max-handoff.php';
    // Extracted verbatim from git origin baseline; only the external send is a spy.
    eval(substr(handoff_source("<?php\n" . $input['oldDispatcher']), 5));
} else {
    // The real API declares respond_to_order_query, so load in a separate process.
    throw new RuntimeException('Use ownership-full.php for full mode');
}
$results = [];
foreach ($input['updates'] as $update) {
    $GLOBALS['emissions'] = [];
    process_bot_update($update);
    $results[] = ['replies'=>$GLOBALS['emissions'], 'forwards'=>[]];
}
echo json_encode($results, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
