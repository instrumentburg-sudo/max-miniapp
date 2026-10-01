<?php
declare(strict_types=1);
define('MAX_API_TEST_MODE', true);
require __DIR__ . '/../api-php/index.php';
$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$results = [];
foreach ($input['updates'] as $update) {
    $replies = []; $forwards = [];
    process_bot_update($update,
        function($id, $text) use (&$replies) { $replies[] = ['id'=>$id,'text'=>$text]; },
        function($body) use (&$forwards) { $forwards[] = ['body'=>$body, 'envelope'=>max_forward_start_envelope($body, 'matrix-only-token', (string)time())]; });
    $results[] = ['replies'=>$replies, 'forwards'=>$forwards];
}
echo json_encode($results, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
