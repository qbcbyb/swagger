export const loginUserText = `
// test for generate
export class LoginUserDto {

    /** username */
    username?: string;
    /** password */
    password?: string;
}
`;

export const loginUserTranspiled = `// test for generate
export class LoginUserDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { username: { required: false, type: () => String, description: "username" }, password: { required: false, type: () => String, description: "password" } };
    }
}
`;
