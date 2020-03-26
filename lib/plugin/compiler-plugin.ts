import * as ts from 'typescript';
import { mergePluginOptions } from './merge-options';
import { ControllerClassVisitor } from './visitors/controller-class.visitor';
import { ModelClassVisitor } from './visitors/model-class.visitor';
import { before as swaggerBefore } from '@nestjs/swagger/dist/plugin/compiler-plugin';

const modelClassVisitor = new ModelClassVisitor();
const controllerClassVisitor = new ControllerClassVisitor();
const isFilenameMatched = (patterns: string[], filename: string) =>
  patterns.some(path => filename.includes(path));

export const before = (options?: Record<string, any>, program?: ts.Program) => {
  const swaggerTransformerGenerator = swaggerBefore(options, program);
  options = mergePluginOptions(options);

  return (ctx: ts.TransformationContext): ts.Transformer<any> => {
    const swaggerTransformer = swaggerTransformerGenerator(ctx);
    return (sf: ts.SourceFile) => {
      sf = swaggerTransformer(sf);
      if (isFilenameMatched(options.dtoFileNameSuffix, sf.fileName)) {
        return modelClassVisitor.visit(sf, ctx, program, options);
      }
      if (isFilenameMatched(options.controllerFileNameSuffix, sf.fileName)) {
        return controllerClassVisitor.visit(sf, ctx, program, options);
      }
      return sf;
    };
  };
};
