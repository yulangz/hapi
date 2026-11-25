package app.hamlet.companion.feature.chat.blocks

import androidx.compose.runtime.Composable
import app.hamlet.companion.feature.chat.PagedTextContent
import app.hamlet.companion.feature.chat.ToolPageBudget
import app.hamlet.companion.feature.chat.readTextPage
import app.hamlet.companion.ui.markdown.CodeBlock

/** A fixed layout budget applies even to inputs consisting almost entirely of newlines. */
@Composable
internal fun ToolTextContent(code: String, language: String? = null, terminal: Boolean = false, isError: Boolean = false) {
    val render: @Composable (String) -> Unit = {
        if (terminal) TerminalText(it, isError = isError) else CodeBlock(code = it, language = language)
    }
    if (fitsToolPage(code)) render(code)
    else PagedTextContent(code, ToolPageBudget, content = render)
}

internal fun fitsToolPage(text: String): Boolean = readTextPage(text, budget = ToolPageBudget).end == text.length
