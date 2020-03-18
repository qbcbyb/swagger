import { ApiOperation } from '@nestjs/swagger';
import { getDecoratorArguments } from '@nestjs/swagger/dist/plugin/utils/ast-utils';
import {
  getDecoratorOrUndefinedByNames,
  hasPropertyKey
} from '@nestjs/swagger/dist/plugin/utils/plugin-utils';
import { compact, head } from 'lodash';
import * as ts from 'typescript';
import { getMainCommentAnExamplesOfNode } from '../utils/ast-utils';
import { AbstractFileVisitor } from './abstract.visitor';

export class ControllerClassVisitor extends AbstractFileVisitor {
  visit(
    sourceFile: ts.SourceFile,
    ctx: ts.TransformationContext,
    program: ts.Program
  ) {
    const typeChecker = program.getTypeChecker();

    const visitNode = (node: ts.Node): ts.Node => {
      if (!this.hasOpenApiDeclared && ts.isImportEqualsDeclaration(node)) {
        if (this.checkIsOpenApiImport(node)) {
          this.updateImports(sourceFile);
        }
      }
      if (ts.isMethodDeclaration(node)) {
        return this.addDecoratorToNode(
          node,
          typeChecker,
          sourceFile.fileName,
          sourceFile
        );
      }
      return ts.visitEachChild(node, visitNode, ctx);
    };
    return ts.visitNode(sourceFile, visitNode);
  }

  addDecoratorToNode(
    compilerNode: ts.MethodDeclaration,
    typeChecker: ts.TypeChecker,
    hostFilename: string,
    sourceFile: ts.SourceFile
  ): ts.MethodDeclaration {
    const node = ts.getMutableClone(compilerNode);
    const nodeArray = node.decorators || ts.createNodeArray();
    const { pos, end } = nodeArray;

    node.decorators = Object.assign(
      [
        ...this.createApiOperationOrEmptyInArray(node, nodeArray, sourceFile),
        ...nodeArray
      ],
      { pos, end }
    );
    return node;
  }

  createApiOperationOrEmptyInArray(
    node: ts.MethodDeclaration,
    nodeArray: ts.NodeArray<ts.Decorator>,
    sourceFile: ts.SourceFile
  ) {
    const descriptionKey = 'description';
    const apiOperationDecorator = getDecoratorOrUndefinedByNames(
      [ApiOperation.name],
      nodeArray
    );
    let apiOperationOptions: ts.ObjectLiteralExpression;
    let apiOperationOptionsProperties: ts.NodeArray<ts.PropertyAssignment>;
    let comments;
    if (
      // No ApiOperation or No ApiOperationOptions or ApiOperationOptions is empty or No description in ApiOperationOptions
      (!apiOperationDecorator ||
        !(apiOperationOptions = head(
          getDecoratorArguments(apiOperationDecorator)
        )) ||
        !(apiOperationOptionsProperties = apiOperationOptions.properties as ts.NodeArray<
          ts.PropertyAssignment
        >) ||
        !hasPropertyKey(descriptionKey, apiOperationOptionsProperties)) &&
      // Has comments
      ([comments] = getMainCommentAnExamplesOfNode(node, sourceFile))[0]
    ) {
      const properties = [
        ts.createPropertyAssignment(descriptionKey, ts.createLiteral(comments)),
        ...(apiOperationOptionsProperties ?? ts.createNodeArray())
      ];
      const apiOperationDecoratorArguments: ts.NodeArray<ts.Expression> = ts.createNodeArray(
        [ts.createObjectLiteral(compact(properties))]
      );
      if (apiOperationDecorator) {
        (apiOperationDecorator.expression as ts.CallExpression).arguments = apiOperationDecoratorArguments;
      } else {
        return [
          ts.createDecorator(
            ts.createCall(
              ts.createIdentifier(
                `${this.openApiNamespace}.${ApiOperation.name}`
              ),
              undefined,
              apiOperationDecoratorArguments
            )
          )
        ];
      }
    }
    return [];
  }
}
