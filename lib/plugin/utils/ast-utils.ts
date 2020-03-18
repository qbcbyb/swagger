import {
  CommentRange,
  getLeadingCommentRanges,
  getTrailingCommentRanges,
  Node,
  SourceFile
} from 'typescript';

export function getMainCommentAnExamplesOfNode(
  node: Node,
  sourceFile: SourceFile,
  needExamples?: boolean
): [string, string[]] {
  const sourceText = sourceFile.getFullText();

  const replaceRegex = /^ *\** *@.*$|^ *\/\*+ *|^ *\/\/+.*|^ *\/+ *|^ *\*+ *| +$| *\**\/ *$/gim;

  const commentResult = [];
  const examplesResult = [];
  const extractCommentsAndExamples = (comments?: CommentRange[]) =>
    comments?.forEach(comment => {
      const commentSource = sourceText.substring(comment.pos, comment.end);
      const oneComment = commentSource.replace(replaceRegex, '').trim();
      if (oneComment) {
        commentResult.push(oneComment);
      }
      if (needExamples) {
        const regexOfExample = /@example *['"]?([^ ]+?)['"]? *$/gim;
        let execResult: RegExpExecArray;
        while (
          (execResult = regexOfExample.exec(commentSource)) &&
          execResult.length > 1
        ) {
          examplesResult.push(execResult[1]);
        }
      }
    });
  extractCommentsAndExamples(
    getLeadingCommentRanges(sourceText, node.getFullStart())
  );
  if (!commentResult.length) {
    extractCommentsAndExamples(
      getTrailingCommentRanges(sourceText, node.getFullStart())
    );
  }

  return [commentResult.join('\n'), examplesResult];
}
