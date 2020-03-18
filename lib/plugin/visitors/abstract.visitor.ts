import * as ts from 'typescript';
import {
  OPENAPI_NAMESPACE,
  OPENAPI_PACKAGE_NAME
} from '@nestjs/swagger/dist/plugin/plugin-constants';

const OPENAPI_NAMESPACE_WITH_PREFIX = `pre_${OPENAPI_NAMESPACE}`;
export class AbstractFileVisitor {
  _openApiNamespace: string | null = null;

  get openApiNamespace(): string {
    return this._openApiNamespace ?? OPENAPI_NAMESPACE_WITH_PREFIX;
  }

  get hasOpenApiDeclared() {
    return this._openApiNamespace !== null;
  }

  checkIsOpenApiImport(openApiDeclaration: ts.ImportEqualsDeclaration) {
    const nameIdentifier = openApiDeclaration.name as ts.Identifier;
    const moduleReference = openApiDeclaration.moduleReference as ts.ExternalModuleReference;
    const identifier = moduleReference.expression as ts.Identifier;
    if (
      identifier.text === OPENAPI_PACKAGE_NAME ||
      identifier.escapedText === OPENAPI_PACKAGE_NAME
    ) {
      this._openApiNamespace = nameIdentifier.escapedText.toString();
      return true;
    }
    return false;
  }

  updateImports(sourceFile: ts.SourceFile): ts.SourceFile {
    if (!this._openApiNamespace) return sourceFile;
    return ts.updateSourceFileNode(sourceFile, [
      ts.createImportEqualsDeclaration(
        undefined,
        undefined,
        OPENAPI_NAMESPACE_WITH_PREFIX,
        ts.createExternalModuleReference(ts.createLiteral(OPENAPI_PACKAGE_NAME))
      ),
      ...sourceFile.statements
    ]);
  }
}
